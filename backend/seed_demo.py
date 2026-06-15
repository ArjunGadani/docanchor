"""Idempotent demo-document seeding.

On startup we ingest the bundled HR docs as `is_demo=true` so the app is useful
immediately. Seeding is skipped if demo docs already exist, so cold-start
restarts never re-embed (which would be slow and would duplicate rows).
"""
import logging
from pathlib import Path

from rag import demo_exists, ingest_stream

logger = logging.getLogger("docsrag.seed")

DEMO_DIR = Path(__file__).resolve().parent / "demo_docs"
DEMO_SESSION = "__demo__"  # demo chunks are matched via is_demo, not session
SUPPORTED = {".md", ".markdown", ".txt", ".pdf", ".docx"}


def seed_demo(force: bool = False) -> None:
    """Ingest demo docs unless they're already present (or force=True)."""
    try:
        if not force and demo_exists():
            logger.info("Demo docs already present — skipping seed.")
            return
    except Exception as exc:
        logger.warning("Could not check demo state (%s); skipping seed.", type(exc).__name__)
        return

    files = [f for f in sorted(DEMO_DIR.glob("*")) if f.suffix.lower() in SUPPORTED]
    if not files:
        logger.warning("No demo docs found in %s", DEMO_DIR)
        return

    for f in files:
        data = f.read_bytes()
        for ev in ingest_stream(DEMO_SESSION, f.name, data, is_demo=True):
            if ev["stage"] == "error":
                logger.error("Seed error for %s: %s", f.name, ev["detail"])
            elif ev["stage"] == "done":
                logger.info("Seeded %s (%d chunks)", f.name, ev["chunks"])
