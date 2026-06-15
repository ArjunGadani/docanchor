"""DocsRAG — single deployable FastAPI service.

Serves the built React SPA as static files *and* exposes the JSON/streaming
API (see docs/project_details.md §2). Runs as a single Uvicorn worker because
the Render free tier is memory-constrained (see the build plan memory gate).

API routes live under /api/*. Everything else falls through to the SPA so
client-side routing works.
"""
import json
import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from groq import RateLimitError

import llm
import rag
import ratelimit
from config import settings
from intent import classify
from migrate import run_migration
from schemas import (
    ChatRequest,
    DeleteDocRequest,
    HealthResponse,
    SessionRequest,
    UrlRequest,
)
from seed_demo import seed_demo
from supabase_client import db_healthcheck

_LLM_DOWN = "The assistant is temporarily unavailable. You can add your own Groq API key to continue."
_SEARCH_DOWN = "Search is temporarily unavailable. Please try again."
BYO_INVITE = (
    "You've reached today's free question limit on the shared key. To keep "
    "chatting, add your own Groq API key — it's free at console.groq.com, stays "
    "in your browser, and is never stored on our servers."
)
# Shown when a request used its OWN Groq key and that key rate-limited.
BYO_OWN_LIMIT = (
    "Your Groq API key hit its rate limit. Wait a moment and retry, or switch "
    "to the Fast (8B) model, which has a higher free allowance."
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("docsrag")


def _startup_tasks():
    # 1) Apply db/schema.sql if DATABASE_URL is set — makes the deploy one-shot
    #    (tables + match_chunks RPC + HNSW index). No-op/safe otherwise.
    run_migration()
    # 2) Seed demo docs (idempotent; skips if already present).
    seed_demo()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run migration + seeding in the background so /api/health is available
    # immediately (the first-ever boot embeds 3 docs; later boots skip).
    threading.Thread(target=_startup_tasks, daemon=True, name="startup").start()
    yield


app = FastAPI(
    title="DocsRAG",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",  # keep schema under /api so the SPA catch-all doesn't shadow it
    redoc_url=None,
    lifespan=lifespan,
)


# --- API -------------------------------------------------------------------
@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Fast liveness check for the boot screen + keep-alive cron.

    Also runs a trivial Supabase query so the periodic ping counts as DB
    activity and prevents the free project from pausing after 7 idle days.
    """
    return HealthResponse(status="ok", db=db_healthcheck())


def _ndjson(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False) + "\n"


def _public_source(s: dict) -> dict:
    """Only the fields the UI needs for citation cards."""
    return {k: s[k] for k in ("id", "doc", "loc", "text", "match")}


def _client_ip(request: Request) -> str:
    """Client IP, honoring Render's X-Forwarded-For proxy header."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _record_usage(meta: dict) -> None:
    """Count tokens used against the model's daily budget (best-effort)."""
    usage = meta.get("usage")
    if usage is not None:
        model = meta.get("model") or settings.primary_model
        ratelimit.record_tokens(model, getattr(usage, "total_tokens", 0) or 0)


@app.post("/api/chat")
async def chat(req: ChatRequest, request: Request):
    """RAG chat over NDJSON: a `sources` event first, then answer `delta`
    events, then a final `done` (or `error`) event.

    Greeting/chitchat/meta skip retrieval and citations. Document questions are
    history-aware (query rewritten to standalone form before retrieval) and
    rate-limited on the shared key; a BYO key bypasses limits.
    """
    byo = bool(req.user_api_key)
    ip = _client_ip(request)
    model = req.model or settings.primary_model

    def _rate_limited_response():
        yield _ndjson({"type": "sources", "sources": []})
        yield _ndjson({"type": "delta", "text": BYO_INVITE})
        yield _ndjson({"type": "done", "used_context": False, "limited": True})

    def _on_groq_429():
        # Distinguish a BYO key hitting its own limit (don't invite a key they
        # already have) from the shared key being exhausted (invite BYO).
        if byo:
            yield _ndjson({"type": "delta", "text": BYO_OWN_LIMIT})
            yield _ndjson({"type": "done", "used_context": False})
        else:
            yield _ndjson({"type": "delta", "text": BYO_INVITE})
            yield _ndjson({"type": "done", "used_context": False, "limited": True})

    def gen():
        # Meter EVERY shared-key request (greetings included) at attempt time, so
        # the greeting path can't bypass limits and disconnects can't dodge the cap.
        if not byo:
            if not ratelimit.allowed(ip, model):
                yield from _rate_limited_response()
                return
            ratelimit.record_question(ip)

        intent = classify(req.message)

        # --- Greeting / thanks / meta: no retrieval, no citations ---
        if intent in ("greeting", "meta"):
            yield _ndjson({"type": "sources", "sources": []})
            loaded = rag.list_loaded_doc_names(req.session_id) if intent == "meta" else []
            messages = llm.build_greeting_messages(req.message, req.history, loaded)
            meta: dict = {}
            try:
                for delta in llm.stream_answer(messages, req.model, req.user_api_key, meta):
                    yield _ndjson({"type": "delta", "text": delta})
                if not byo:
                    _record_usage(meta)
                yield _ndjson({"type": "done", "used_context": False, "model": meta.get("model")})
            except RateLimitError:
                yield from _on_groq_429()
            except Exception:
                logger.exception("greeting stream failed")
                yield _ndjson({"type": "error", "detail": _LLM_DOWN})
            return

        # --- Document question: history-aware rewrite → retrieve ---
        search_query = req.message
        if req.history:
            rewrite_meta: dict = {}
            search_query = llm.rewrite_query(req.message, req.history, req.user_api_key, rewrite_meta)
            if not byo:
                _record_usage(rewrite_meta)  # count the rewrite call's tokens too

        try:
            sources = rag.retrieve(search_query, req.session_id, req.docs)
        except Exception:
            logger.exception("retrieval failed")
            yield _ndjson({"type": "error", "detail": _SEARCH_DOWN})
            return

        yield _ndjson({"type": "sources", "sources": [_public_source(s) for s in sources]})

        # No chunk cleared the weak threshold → canned no-hallucination answer
        # (skips the LLM call entirely, saving Groq tokens).
        if not sources:
            yield _ndjson({"type": "delta", "text": llm.NO_MATCH_ANSWER})
            yield _ndjson({"type": "done", "used_context": False, "grounding": "none", "n_sources": 0})
            return

        messages = llm.build_messages(req.message, req.history, sources)
        meta = {}
        answer_text = ""
        try:
            for delta in llm.stream_answer(messages, req.model, req.user_api_key, meta):
                answer_text += delta
                yield _ndjson({"type": "delta", "text": delta})
            if not byo:
                _record_usage(meta)

            # Suggested follow-up (cheap 8B; best-effort). Skip when the shared
            # key's budget is already spent so it can't overshoot.
            if byo or ratelimit.allowed(ip, model):
                sug_meta: dict = {}
                items = llm.suggest_followups(req.message, answer_text, req.user_api_key, sug_meta)
                if not byo:
                    _record_usage(sug_meta)
                if items:
                    yield _ndjson({"type": "suggestions", "items": items})

            strong = sum(1 for s in sources if s["match"] == "strong")
            yield _ndjson(
                {
                    "type": "done",
                    "used_context": True,
                    "model": meta.get("model"),
                    "grounding": "high" if strong else "partial",
                    "n_sources": len(sources),
                }
            )
        except RateLimitError:
            yield from _on_groq_429()
        except Exception:
            logger.exception("LLM streaming failed")
            yield _ndjson({"type": "error", "detail": _LLM_DOWN})

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@app.post("/api/upload")
async def upload(
    request: Request,
    session_id: str = Form(...),
    files: list[UploadFile] = File(...),
):
    """Ingest uploaded docs, streaming NDJSON stage updates.

    Files are processed one at a time (each tagged "i of n") so nothing happens
    silently. A failed file emits a `stage:error` event and the batch continues.
    Bytes are read up front (async) so the sync ingest generator can stream.
    """
    ip = _client_ip(request)
    if not ratelimit.ingest_allowed(ip):
        return JSONResponse(status_code=429, content={"detail": "Daily ingestion limit reached. Try again tomorrow."})
    payloads = [(f.filename or "document", await f.read()) for f in files]
    max_bytes = settings.max_upload_mb * 1024 * 1024
    ratelimit.record_ingest(ip)

    def gen():
        total = len(payloads)
        for i, (name, data) in enumerate(payloads, start=1):
            tag = f"{i} of {total}"
            yield _ndjson({"stage": "file", "file": tag, "doc": name})

            if len(data) > max_bytes:
                yield _ndjson({"stage": "error", "file": tag, "doc": name, "detail": f"file exceeds {settings.max_upload_mb} MB"})
                continue
            pages = rag.page_count(name, data)
            if pages > settings.max_pages:
                yield _ndjson({"stage": "error", "file": tag, "doc": name, "detail": f"too many pages ({pages} > {settings.max_pages})"})
                continue

            yield _ndjson({"stage": "uploading", "file": tag, "doc": name, "pct": 100})
            for ev in rag.ingest_stream(session_id, name, data, is_demo=False):
                ev.setdefault("doc", name)
                ev["file"] = tag
                yield _ndjson(ev)

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@app.post("/api/reset")
async def reset(req: SessionRequest):
    """Clear this session's uploaded docs; the demo set (is_demo) remains."""
    try:
        rag.delete_session_docs(req.session_id)
    except Exception:
        logger.exception("reset failed")
        return JSONResponse(status_code=503, content={"detail": "Reset failed. Please try again."})
    return {"status": "ok"}


@app.get("/api/session/docs")
async def session_docs(session_id: str):
    """List the session's uploaded doc names (for the refresh-persistence note)."""
    try:
        names = rag.list_session_docs(session_id)
        all_docs = rag.list_loaded_doc_names(session_id)
    except Exception:
        logger.exception("session docs lookup failed")
        names, all_docs = [], []
    # `docs` = this session's uploads (deletable); `all_docs` = everything
    # visible (demo + uploads) for the document manager / query scoping.
    return {"docs": names, "has_uploads": bool(names), "all_docs": all_docs}


@app.post("/api/session/doc/delete")
async def delete_doc(req: DeleteDocRequest):
    """Delete a single uploaded doc (by name) for this session."""
    try:
        rag.delete_document(req.session_id, req.name)
    except Exception:
        logger.exception("doc delete failed")
        return JSONResponse(status_code=503, content={"detail": "Delete failed. Please try again."})
    return {"status": "ok"}


@app.post("/api/ingest-url")
async def ingest_url(req: UrlRequest, request: Request):
    """Fetch a web page, extract its text, and ingest it — streaming NDJSON
    stages like /api/upload so the UI can show progress."""
    ip = _client_ip(request)
    if not ratelimit.ingest_allowed(ip):
        return JSONResponse(status_code=429, content={"detail": "Daily ingestion limit reached. Try again tomorrow."})
    ratelimit.record_ingest(ip)

    def gen():
        tag = "1 of 1"
        yield _ndjson({"stage": "file", "file": tag, "doc": req.url})
        yield _ndjson({"stage": "fetching", "file": tag, "doc": req.url})
        try:
            title, text = rag.extract_url_text(req.url)
        except Exception as exc:
            yield _ndjson({"stage": "error", "file": tag, "doc": req.url, "detail": f"could not fetch URL: {type(exc).__name__}"})
            return
        if not text.strip():
            yield _ndjson({"stage": "error", "file": tag, "doc": title, "detail": "no readable text on that page"})
            return
        for ev in rag.ingest_stream(req.session_id, title, text.encode("utf-8"), is_demo=False):
            ev.setdefault("doc", title)
            ev["file"] = tag
            yield _ndjson(ev)

    return StreamingResponse(gen(), media_type="application/x-ndjson")


# --- Static SPA serving ----------------------------------------------------
# In dev, Vite serves the frontend on :5173 and proxies /api here, so the build
# output may not exist — guard for that. In production the Dockerfile copies the
# Vite build into this directory.
STATIC_DIR = Path(settings.static_dir)
INDEX_FILE = STATIC_DIR / "index.html"


@app.get("/{full_path:path}", include_in_schema=False)
def serve_spa(full_path: str):
    """Serve static assets, falling back to index.html for SPA routes.

    /api/* routes are registered above and match first. Unknown /api/* paths
    return JSON 404 (never the HTML shell). Any request mapping to a real file
    under the static dir is served directly; everything else returns the SPA
    shell so the client router can handle the path.
    """
    if full_path == "api" or full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"detail": "Not found"})

    if not INDEX_FILE.exists():
        return JSONResponse(
            status_code=404,
            content={
                "detail": "Frontend not built. Run the Vite build, or use the "
                "dev server on :5173 which proxies /api here."
            },
        )

    candidate = (STATIC_DIR / full_path).resolve()
    # Serve real files (assets), guarding against path traversal outside STATIC_DIR.
    if candidate.is_file() and STATIC_DIR.resolve() in candidate.parents:
        return FileResponse(candidate)
    return FileResponse(INDEX_FILE)
