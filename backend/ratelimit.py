"""Rate limiting + token budgeting for the shared (server-owned) Groq key.

Two soft limits, reset daily:
  - per-IP daily question cap (default 10), and
  - per-model daily token budget kept under Groq's free TPD.

Counters are in-process. Render's free tier is single-instance, so this is
correct for one box; counters reset on cold-start restart, which only makes the
limits *more* lenient (acceptable for a demo). The authoritative backstop is a
Groq 429 — caught by the chat handler, which also surfaces the BYO-key invite.
Bring-your-own-key requests bypass these limits entirely.

The spec permits "in-memory or Supabase counter"; in-memory avoids a second DDL
migration. Swap the storage here if durable, multi-instance counting is needed.
"""
import threading
from collections import defaultdict
from datetime import date

from config import settings

_lock = threading.Lock()
_state = {"date": ""}
_ip_questions: dict = defaultdict(int)
_ip_ingests: dict = defaultdict(int)
_model_tokens: dict = defaultdict(int)


def _roll_if_new_day() -> None:
    today = date.today().isoformat()
    if _state["date"] != today:
        _state["date"] = today
        _ip_questions.clear()
        _ip_ingests.clear()
        _model_tokens.clear()


def _token_cap(model: str) -> int:
    return (
        settings.token_budget_fallback
        if model == settings.fallback_model
        else settings.token_budget_primary
    )


def allowed(ip: str, model: str) -> bool:
    """True if this IP still has questions left AND the model's token budget
    isn't exhausted."""
    with _lock:
        _roll_if_new_day()
        if _ip_questions[ip] >= settings.per_ip_daily_limit:
            return False
        if _model_tokens[model] >= _token_cap(model):
            return False
        return True


def record_question(ip: str) -> None:
    with _lock:
        _roll_if_new_day()
        _ip_questions[ip] += 1


def record_tokens(model: str, tokens: int) -> None:
    if not tokens:
        return
    with _lock:
        _roll_if_new_day()
        _model_tokens[model] += tokens


def ingest_allowed(ip: str) -> bool:
    """Per-IP daily cap on uploads + URL ingests (DoS / SSRF-spam guard)."""
    with _lock:
        _roll_if_new_day()
        return _ip_ingests[ip] < settings.per_ip_ingest_limit


def record_ingest(ip: str) -> None:
    with _lock:
        _roll_if_new_day()
        _ip_ingests[ip] += 1
