"""Pydantic models shared across the API."""
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    # User-selected model; None means use the configured primary (8B).
    model: Optional[str] = None
    # Bring-your-own Groq key: used per-request only, never persisted or logged.
    user_api_key: Optional[str] = None
    session_id: str
    # Optional: scope retrieval to these document names (document manager).
    docs: Optional[list[str]] = None


class Source(BaseModel):
    """A retrieved chunk surfaced to the UI as a citation/source card."""

    id: int
    doc: str
    loc: str
    text: str
    match: Literal["strong", "partial"]


class SessionRequest(BaseModel):
    session_id: str


class DeleteDocRequest(BaseModel):
    session_id: str
    name: str


class UrlRequest(BaseModel):
    session_id: str
    url: str


class HealthResponse(BaseModel):
    status: str = "ok"
    db: bool = False
