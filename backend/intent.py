"""Cheap, local intent classification — no LLM call (saves a Groq round-trip).

Three buckets:
  - "greeting": greetings, thanks, closings → warm reply, no retrieval.
  - "meta":     questions about the app itself / what docs are loaded.
  - "document": everything else → full RAG flow.

We deliberately default to "document" when unsure: for a Q&A tool, treating a
real question as chitchat is worse than the reverse.
"""
import re

_GREETING_WORDS = {
    "hi", "hello", "hey", "heya", "hiya", "yo", "yt", "sup", "greetings",
    "gm", "morning",
}
_GREETING_PHRASES = ("good morning", "good afternoon", "good evening", "good day")
_THANKS_WORDS = {
    "thanks", "thank", "thankyou", "thx", "ty", "cheers", "bye", "goodbye",
    "later", "ok", "okay", "cool", "great", "awesome", "nice", "perfect",
}
# Filler dropped before deciding a short message is pure thanks/closing,
# so "thank you so much" still reads as a greeting.
_THANKS_FILLER = {
    "you", "so", "much", "a", "lot", "very", "really", "the", "for", "it",
    "that", "again", "man", "guys", "team", "everything", "all", "u",
}
_META_PATTERNS = [
    r"\bwhat can you do\b",
    r"\bwhat do you do\b",
    r"\bwho are you\b",
    r"\bhow (do|does|can) (this|you|it)\b.*\bwork\b",
    r"\bwhat (is|are) (this|you|docsrag)\b",
    r"\bwhat (documents|docs|files)\b",
    r"\bwhich (documents|docs|files)\b",
    r"\bwhat can i ask\b",
    r"\bhow can you help\b",
    r"\byour capabilities\b",
]


def classify(message: str) -> str:
    text = message.strip().lower()
    if not text:
        return "greeting"

    for pat in _META_PATTERNS:
        if re.search(pat, text):
            return "meta"

    # Normalize: drop punctuation for keyword matching.
    stripped = re.sub(r"[^\w\s]", "", text).strip()
    words = stripped.split()
    has_question = "?" in text

    # Only treat very short, question-free messages as greetings/thanks, so we
    # don't swallow real questions like "thanks, what's the notice period?".
    if len(words) <= 4 and not has_question:
        if any(text.startswith(p) for p in _GREETING_PHRASES):
            return "greeting"
        if stripped in _GREETING_WORDS:
            return "greeting"
        if words and words[0] in _GREETING_WORDS:
            return "greeting"
        content = [w for w in words if w not in _THANKS_FILLER]
        if content and all(w in _THANKS_WORDS for w in content):
            return "greeting"

    return "document"
