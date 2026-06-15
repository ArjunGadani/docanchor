"""Lazy Supabase client.

Uses the service-role key, so this must only ever run server-side. The client
is created once and reused. ``db_healthcheck`` doubles as the keep-alive probe:
a trivial query executes real SQL on Postgres, which counts as activity and
stops the free Supabase project from pausing after 7 idle days.
"""
from functools import lru_cache

from supabase import Client, create_client

from config import settings


@lru_cache
def get_supabase() -> Client:
    if not settings.supabase_url or not settings.supabase_key:
        raise RuntimeError("Supabase credentials are not configured.")
    return create_client(settings.supabase_url, settings.supabase_key)


def db_healthcheck() -> bool:
    """Return True if Supabase is reachable.

    Runs a tiny `select ... limit 1` against the ``documents`` table. This both
    confirms connectivity and registers DB activity for the keep-alive ping.
    Swallows all errors (e.g. table not created yet) so /api/health never 500s.
    """
    try:
        get_supabase().table("documents").select("id").limit(1).execute()
        return True
    except Exception:
        return False
