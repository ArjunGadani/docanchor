"""Application configuration.

Values come from environment variables (Render dashboard in production) and
fall back to the project-root ``.env`` for local development. Defaults live
here so the rest of the code never hard-codes tunables. See the build plan for
why the Groq token budgets and retrieval thresholds are set the way they are.
"""
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

# Project root = parent of the ``backend`` package. The real ``.env`` (with
# secrets) lives here; in Docker/Render the values come from real env vars
# instead, which pydantic-settings reads first.
ROOT_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR_DEFAULT = ROOT_DIR / "frontend" / "dist"


class Settings(BaseSettings):
    # --- Supabase (server-side only) ---
    supabase_url: str = ""
    supabase_key: str = ""

    # --- Groq (OpenAI-compatible endpoint) ---
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    # 8B is primary (500K TPD on Groq free → survives heavy demo traffic).
    # 70B is the user-selectable "Best" model AND the cross-fallback target.
    primary_model: str = "llama-3.1-8b-instant"
    fallback_model: str = "llama-3.3-70b-versatile"
    rewrite_model: str = "llama-3.1-8b-instant"  # cheap history-aware rewrite

    # --- Embeddings / retrieval ---
    embedding_model: str = "BAAI/bge-small-en-v1.5"  # 384-dim, 512-token, ONNX
    embedding_dim: int = 384
    # Where fastembed caches the ONNX model. In Docker this is baked into the
    # image at this path so there is no runtime download on cold start.
    embedding_cache_dir: Optional[str] = None
    top_k: int = 5
    scope_overfetch: int = 100  # candidates to fetch before doc-scope filtering
    # Cosine-similarity thresholds, tuned against the demo docs for bge-small:
    # relevant matches score ~0.58-0.70, irrelevant ~0.42-0.44, so the weak
    # floor must sit above the noise (~0.45) to reject off-topic questions.
    strong_threshold: float = 0.55
    weak_threshold: float = 0.45
    chunk_tokens: int = 500
    chunk_overlap: int = 80
    max_history_turns: int = 6

    # --- Limits (enforced via Supabase counters; see ratelimit.py) ---
    per_ip_daily_limit: int = 10
    per_ip_ingest_limit: int = 20  # uploads + URL ingests per IP per day
    # Daily token budgets kept under Groq free TPD (8B=500K, 70B=100K) with
    # headroom. A Groq 429 is the authoritative backstop either way.
    token_budget_primary: int = 450_000
    token_budget_fallback: int = 90_000

    # --- Upload guards ---
    max_upload_mb: int = 10
    max_pages: int = 100

    # --- Static SPA dir (Vite build output) ---
    static_dir: str = str(STATIC_DIR_DEFAULT)

    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",  # tolerate unrelated/legacy env vars (e.g. DAILY_GLOBAL_LIMIT)
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
