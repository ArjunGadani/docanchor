"""Optional one-shot DB migration.

The Supabase service-role key (PostgREST) cannot run DDL, so tables + the
`match_chunks` RPC + HNSW index normally have to be applied by hand. If a direct
Postgres connection string is provided via ``DATABASE_URL`` (Supabase →
Settings → Database → Connection string), we run ``db/schema.sql`` on startup so
the deploy is genuinely one-shot. It is idempotent (CREATE ... IF NOT EXISTS /
CREATE OR REPLACE), and best-effort: any failure is logged, never fatal — the
app still runs (retrieval has an in-Python fallback).
"""
import logging
import os
from pathlib import Path

logger = logging.getLogger("docsrag.migrate")

# schema.sql lives in db/ at the repo root. Try the local layout and the Docker
# layout (/app/db) so it resolves in both.
_CANDIDATES = [
    Path(__file__).resolve().parent.parent / "db" / "schema.sql",  # local: repo/db
    Path("/app/db/schema.sql"),                                     # docker
    Path(__file__).resolve().parent / "db" / "schema.sql",
]


def _schema_path():
    for p in _CANDIDATES:
        if p.is_file():
            return p
    return None


def run_migration() -> None:
    """Apply db/schema.sql via DATABASE_URL, if configured. No-op otherwise."""
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        logger.info("DATABASE_URL not set — skipping auto-migration (run db/schema.sql manually for the pgvector RPC).")
        return

    path = _schema_path()
    if not path:
        logger.warning("schema.sql not found; skipping auto-migration.")
        return

    try:
        import psycopg  # imported lazily so the app runs without it when unused
    except Exception:
        logger.warning("psycopg not installed; skipping auto-migration.")
        return

    sql = path.read_text(encoding="utf-8")
    try:
        with psycopg.connect(dsn, autocommit=True, connect_timeout=15) as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
        logger.info("Auto-migration applied (%s).", path)
    except Exception as exc:
        # Never crash the boot on a migration hiccup — the Python fallback covers it.
        logger.warning("Auto-migration failed (%s): %s", type(exc).__name__, exc)
