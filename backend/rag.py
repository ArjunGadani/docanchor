"""RAG core: embeddings, document ingestion, and retrieval.

Embeddings use fastembed (ONNX, no torch) with BAAI/bge-small-en-v1.5 — light
enough for the Render free tier. The model is lazy-loaded and pinned to a single
ONNX thread (the box has ~0.1 CPU; see the build plan memory gate).

bge-small is an *asymmetric* retriever: queries and passages get different
instruction prefixes. fastembed handles this via `query_embed()` (queries) vs
`embed()` (passages) — using the wrong one quietly degrades retrieval.
"""
import io
import ipaddress
import json
import logging
import math
import re
import socket
import threading
from functools import lru_cache
from html.parser import HTMLParser
from typing import Iterator, Optional
from urllib.parse import urljoin, urlparse

import docx
import httpx
import tiktoken
from fastembed import TextEmbedding
from pypdf import PdfReader

from config import settings
from supabase_client import get_supabase

logger = logging.getLogger("docsrag.rag")

# --- Embedder ---------------------------------------------------------------


_embedder_instance: Optional[TextEmbedding] = None
_embedder_lock = threading.Lock()


def _embedder() -> TextEmbedding:
    # Double-checked locking singleton. NOT functools.lru_cache: lru_cache runs
    # the wrapped function OUTSIDE its lock, so two concurrent first-callers (the
    # startup seed thread + a first request) could both build the model and load
    # the ONNX weights twice → a transient ~2x memory spike that can OOM the
    # 512MB box. The lock guarantees a single load.
    #
    # lazy_load defers the (one-time) load until first embed; threads=1 keeps CPU
    # and memory bounded; cache_dir points at the model baked into the image.
    global _embedder_instance
    if _embedder_instance is None:
        with _embedder_lock:
            if _embedder_instance is None:
                _embedder_instance = TextEmbedding(
                    model_name=settings.embedding_model,
                    cache_dir=settings.embedding_cache_dir,
                    threads=1,
                    lazy_load=True,
                )
    return _embedder_instance


def embed_passages(texts: list[str]) -> Iterator[list[float]]:
    """Yield one embedding per passage, in input order (memory-friendly)."""
    for vec in _embedder().embed(texts):
        yield vec.tolist()


def embed_query(text: str) -> list[float]:
    """Embed a search query (uses bge's query instruction prefix)."""
    return next(iter(_embedder().query_embed([text]))).tolist()


# --- Tokenizer / chunking ----------------------------------------------------


@lru_cache
def _tokenizer():
    # cl100k_base is a good general-purpose tokenizer for sizing chunks.
    return tiktoken.get_encoding("cl100k_base")


def chunk_text(text: str, max_tokens: int, overlap: int) -> list[str]:
    """Split text into ~max_tokens windows with `overlap` tokens of context."""
    text = text.strip()
    if not text:
        return []
    enc = _tokenizer()
    tokens = enc.encode(text)
    if len(tokens) <= max_tokens:
        return [text]
    step = max(1, max_tokens - overlap)
    chunks = []
    for start in range(0, len(tokens), step):
        window = tokens[start : start + max_tokens]
        piece = enc.decode(window).strip()
        if piece:
            chunks.append(piece)
        if start + max_tokens >= len(tokens):
            break
    return chunks


# --- Text extraction ---------------------------------------------------------


def _clean(text: str) -> str:
    """Normalize messy whitespace while preserving line structure."""
    text = text.replace("\x00", " ")
    out: list[str] = []
    for line in text.splitlines():
        line = re.sub(r"[ \t]+", " ", line).strip()
        if line or (out and out[-1] != ""):  # collapse runs of blank lines
            out.append(line)
    return "\n".join(out).strip()


def _split_markdown(text: str) -> list[dict]:
    """Split markdown into sections keyed by heading (loc = '§ <heading>')."""
    segments: list[dict] = []
    current = ""  # leading content before the first heading
    buf: list[str] = []

    def flush():
        body = "\n".join(buf).strip()
        if body:
            segments.append({"loc": current or "", "text": body})

    for line in text.splitlines():
        m = re.match(r"^(#{1,6})\s+(.*)", line)
        if m:
            flush()
            buf = []
            current = "§ " + m.group(2).strip()
        else:
            buf.append(line)
    flush()
    if not segments and text.strip():
        segments = [{"loc": "", "text": text.strip()}]
    return segments


def extract_segments(filename: str, data: bytes) -> list[dict]:
    """Extract text as a list of {loc, text} segments, preserving location.

    PDF → one segment per page (loc 'p.N'); MD → one per heading section
    (loc '§ heading'); DOCX/TXT → a single segment. Returns [] if nothing
    extractable.
    """
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""

    if ext == "pdf":
        reader = PdfReader(io.BytesIO(data))
        segments = []
        for i, page in enumerate(reader.pages, start=1):
            txt = _clean(page.extract_text() or "")
            if txt:
                segments.append({"loc": f"p.{i}", "text": txt})
        return segments

    if ext == "docx":
        document = docx.Document(io.BytesIO(data))
        txt = _clean("\n".join(p.text for p in document.paragraphs))
        return [{"loc": "", "text": txt}] if txt else []

    if ext in ("md", "markdown"):
        return _split_markdown(_clean(data.decode("utf-8", "ignore")))

    # txt and any other text-like fallback
    txt = _clean(data.decode("utf-8", "ignore"))
    return [{"loc": "", "text": txt}] if txt else []


def page_count(filename: str, data: bytes) -> int:
    """Cheap page/segment count for the upload max-pages guard."""
    if filename.lower().endswith(".pdf"):
        try:
            return len(PdfReader(io.BytesIO(data)).pages)
        except Exception:
            return 0
    return 1


# --- Ingestion ---------------------------------------------------------------


def ingest_stream(
    session_id: str, name: str, data: bytes, is_demo: bool = False
) -> Iterator[dict]:
    """Ingest one document, yielding stage-by-stage progress dicts.

    Stages: extracting → chunking → embedding (with pct) → storing → done.
    Yields {"stage": "error", ...} instead of raising so a batch can continue.
    """
    sb = get_supabase()

    yield {"stage": "extracting", "detail": "reading document"}
    segments = extract_segments(name, data)
    if not segments:
        yield {"stage": "error", "detail": "no extractable text found"}
        return
    yield {"stage": "extracting", "detail": f"{len(segments)} segment(s)"}

    records = [
        (seg["loc"], piece)
        for seg in segments
        for piece in chunk_text(seg["text"], settings.chunk_tokens, settings.chunk_overlap)
    ]
    total = len(records)
    if total == 0:
        yield {"stage": "error", "detail": "document produced no chunks"}
        return
    yield {"stage": "chunking", "detail": f"{total} chunks"}

    document_id = None
    try:
        doc_resp = (
            sb.table("documents")
            .insert({"name": name, "is_demo": is_demo, "session_id": session_id})
            .execute()
        )
        document_id = doc_resp.data[0]["id"]

        texts = [t for _, t in records]
        rows = []
        for idx, vec in enumerate(embed_passages(texts)):
            rows.append(
                {
                    "document_id": document_id,
                    "content": texts[idx],
                    "loc": records[idx][0],
                    "chunk_index": idx,
                    "embedding": vec,
                    "session_id": session_id,
                }
            )
            if idx % 5 == 0 or idx == total - 1:
                yield {
                    "stage": "embedding",
                    "pct": round((idx + 1) / total * 100),
                    "detail": f"chunk {idx + 1}/{total}",
                }

        yield {"stage": "storing"}
        for i in range(0, len(rows), 100):  # batch inserts to bound payload size
            sb.table("chunks").insert(rows[i : i + 100]).execute()
    except Exception as exc:  # never leak internals to the stream consumer
        # Roll back the document row so a failed ingest doesn't leave an
        # orphan (chunk-less) doc showing in session/meta listings.
        if document_id is not None:
            try:
                sb.table("documents").delete().eq("id", document_id).execute()
            except Exception:
                logger.warning("Failed to roll back orphan document %s", document_id)
        yield {"stage": "error", "detail": f"ingestion failed: {type(exc).__name__}"}
        return

    yield {"stage": "done", "chunks": total, "doc": name}


# --- Retrieval ---------------------------------------------------------------


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _candidates_rpc(qvec: list[float], session_id: str, count: int) -> list[tuple]:
    """Top-`count` candidates via the pgvector/hnsw RPC (production path)."""
    resp = (
        get_supabase()
        .rpc(
            "match_chunks",
            {
                "query_embedding": qvec,
                "match_session": session_id,
                "match_count": count,
            },
        )
        .execute()
    )
    return [
        (float(r["similarity"]), r.get("doc") or "document", r.get("loc") or "", r["content"])
        for r in (resp.data or [])
    ]


def _candidates_python(qvec: list[float], session_id: str, count: int) -> list[tuple]:
    """Fallback: fetch visible chunks and rank by cosine in Python.

    Used when the match_chunks RPC isn't installed yet, so the app works before
    db/schema.sql is applied. Fine at demo scale; the RPC is preferred once
    available (uses the hnsw index and avoids shipping embeddings over the wire).
    Returns at most `count` candidates (bounded, mirrors the RPC path).
    """
    sb = get_supabase()
    docs = sb.table("documents").select("id,name,is_demo,session_id").execute().data or []
    visible = {
        d["id"]: d["name"]
        for d in docs
        if d.get("is_demo") or d.get("session_id") == session_id
    }
    if not visible:
        return []

    rows = (
        sb.table("chunks")
        .select("content,loc,document_id,embedding")
        .in_("document_id", list(visible.keys()))
        .execute()
        .data
        or []
    )
    scored: list[tuple] = []
    for r in rows:
        emb = r["embedding"]
        if isinstance(emb, str):
            emb = json.loads(emb)
        sim = _cosine(qvec, emb)
        scored.append((sim, visible.get(r["document_id"], "document"), r.get("loc") or "", r["content"]))
    scored.sort(key=lambda t: t[0], reverse=True)
    return scored[:count]


def retrieve(
    query: str, session_id: str, docs: Optional[list[str]] = None
) -> list[dict]:
    """Embed the query and return labeled chunks above the weak threshold.

    Two-threshold split: similarity >= strong → 'strong'; in [weak, strong) →
    'partial' (grey area); below weak → discarded. Returns [] if nothing clears
    the weak threshold (caller emits the "couldn't find that" answer).

    `docs` (optional) scopes retrieval to those document names — we widen the
    candidate fetch then filter, so the post-filter top-k is still meaningful.
    """
    qvec = embed_query(query)
    # Over-fetch generously when scoping so the post-filter doesn't starve a
    # selected doc whose chunks rank below the global top-k. Both paths honor it.
    want = settings.scope_overfetch if docs else settings.top_k
    try:
        candidates = _candidates_rpc(qvec, session_id, want)
    except Exception as exc:
        logger.warning("match_chunks RPC unavailable (%s); using Python fallback.", type(exc).__name__)
        candidates = _candidates_python(qvec, session_id, want)

    if docs:
        allow = set(docs)
        candidates = [c for c in candidates if c[1] in allow]
    candidates = candidates[: settings.top_k]

    results: list[dict] = []
    cite_id = 0
    for sim, doc, loc, content in candidates:
        if sim >= settings.strong_threshold:
            match = "strong"
        elif sim >= settings.weak_threshold:
            match = "partial"
        else:
            continue
        cite_id += 1
        results.append(
            {"id": cite_id, "doc": doc, "loc": loc, "text": content, "match": match, "similarity": round(sim, 4)}
        )
    return results


# --- Session / demo helpers --------------------------------------------------


def demo_exists() -> bool:
    resp = get_supabase().table("documents").select("id").eq("is_demo", True).limit(1).execute()
    return bool(resp.data)


def list_session_docs(session_id: str) -> list[str]:
    """Names of the session's *uploaded* docs (excludes demo set)."""
    resp = (
        get_supabase()
        .table("documents")
        .select("name")
        .eq("session_id", session_id)
        .eq("is_demo", False)
        .execute()
    )
    return [r["name"] for r in (resp.data or [])]


def list_loaded_doc_names(session_id: str) -> list[str]:
    """All doc names visible to this session (demo + session uploads) — for the
    'what documents do you have' meta answer."""
    resp = (
        get_supabase()
        .table("documents")
        .select("name,is_demo,session_id")
        .execute()
    )
    names = []
    for r in resp.data or []:
        if r.get("is_demo") or r.get("session_id") == session_id:
            names.append(r["name"])
    return sorted(set(names))


def delete_session_docs(session_id: str) -> None:
    """Remove the session's uploaded docs (chunks cascade). Demo set untouched."""
    get_supabase().table("documents").delete().eq("session_id", session_id).eq(
        "is_demo", False
    ).execute()


def delete_document(session_id: str, name: str) -> None:
    """Remove a single uploaded doc by name for this session (chunks cascade)."""
    get_supabase().table("documents").delete().eq("session_id", session_id).eq(
        "is_demo", False
    ).eq("name", name).execute()


# --- URL ingestion -----------------------------------------------------------


class _HTMLTextExtractor(HTMLParser):
    """Collect visible text + <title>, skipping script/style/noscript."""

    _SKIP = {"script", "style", "noscript", "svg"}

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.title = ""
        self._skip_depth = 0
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag in self._SKIP and self._skip_depth > 0:
            self._skip_depth -= 1
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif self._skip_depth == 0:
            text = data.strip()
            if text:
                self.parts.append(text)


_URL_MAX_BYTES = 3_000_000


def _is_public_host(host: str) -> bool:
    """True only if every address `host` resolves to is a public/global IP.

    Blocks SSRF to loopback/private/link-local/reserved ranges (e.g. localhost,
    10.x, 169.254.169.254 cloud metadata). Best-effort against DNS rebinding —
    we validate at request time and disallow redirects to non-public hosts.
    """
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return False
    for info in infos:
        try:
            addr = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_reserved
            or addr.is_multicast
            or addr.is_unspecified
        ):
            return False
    return True


def extract_url_text(url: str) -> tuple:
    """Fetch a web page and return (title, cleaned_text). Raises on bad URL/fetch.

    SSRF-guarded: only http(s), only public hosts, redirects followed manually
    with the destination host re-validated each hop. Download is streamed and
    capped so a huge/endless response can't OOM the worker.
    """
    if not url.startswith(("http://", "https://")):
        raise ValueError("URL must start with http:// or https://")

    raw = b""
    encoding = "utf-8"
    with httpx.Client(
        timeout=20, follow_redirects=False, headers={"User-Agent": "DocAnchor/1.0"}
    ) as client:
        for _ in range(5):  # bounded manual redirect chain, validating each hop
            host = urlparse(url).hostname
            if not _is_public_host(host):
                raise ValueError("URL host is not allowed")
            with client.stream("GET", url) as resp:
                if resp.is_redirect:
                    loc = resp.headers.get("location")
                    if not loc:
                        raise ValueError("invalid redirect")
                    url = urljoin(str(resp.url), loc)
                    continue
                resp.raise_for_status()
                ctype = resp.headers.get("content-type", "").lower()
                if not any(t in ctype for t in ("html", "text", "xml")):
                    raise ValueError("URL is not an HTML/text page")
                total = 0
                parts = []
                for chunk in resp.iter_bytes():
                    parts.append(chunk)
                    total += len(chunk)
                    if total >= _URL_MAX_BYTES:
                        break
                raw = b"".join(parts)
                encoding = resp.encoding or "utf-8"
                break
        else:
            raise ValueError("too many redirects")

    parser = _HTMLTextExtractor()
    parser.feed(raw.decode(encoding, "ignore"))
    text = _clean("\n".join(parser.parts))
    title = (parser.title.strip() or url)[:120]
    return title, text
