// API client for the DocsRAG backend. Chat and upload stream NDJSON (one JSON
// object per line) over fetch + ReadableStream.

const API = "/api";

export async function getHealth() {
  const r = await fetch(`${API}/health`);
  if (!r.ok) throw new Error("health not ok");
  return r.json();
}

export async function getSessionDocs(sessionId) {
  // Throws on failure so the caller can keep the previous state instead of
  // blanking the document list on a transient error.
  const r = await fetch(`${API}/session/docs?session_id=${encodeURIComponent(sessionId)}`);
  if (!r.ok) throw new Error("session docs fetch failed");
  return r.json();
}

export async function resetSession(sessionId) {
  const r = await fetch(`${API}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  return r.ok;
}

// Yields parsed JSON objects from an NDJSON response stream.
async function* readNDJSON(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) {
        try {
          yield JSON.parse(line);
        } catch {
          /* ignore malformed partial line */
        }
      }
    }
  }
  const tail = (buf + decoder.decode()).trim();
  if (tail) {
    try {
      yield JSON.parse(tail);
    } catch {
      /* ignore */
    }
  }
}

export async function streamChat(
  { message, history, model, userApiKey, sessionId, docs },
  onEvent,
  signal
) {
  const r = await fetch(`${API}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history,
      model,
      user_api_key: userApiKey || null,
      session_id: sessionId,
      docs: docs && docs.length ? docs : null,
    }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error("chat request failed");
  for await (const ev of readNDJSON(r)) onEvent(ev);
}

export async function ingestUrl({ url, sessionId }, onEvent) {
  const r = await fetch(`${API}/ingest-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, session_id: sessionId }),
  });
  if (!r.ok || !r.body) throw new Error("url ingest failed");
  for await (const ev of readNDJSON(r)) onEvent(ev);
}

export async function deleteDoc(sessionId, name) {
  const r = await fetch(`${API}/session/doc/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, name }),
  });
  return r.ok;
}

export async function streamUpload({ files, sessionId }, onEvent) {
  const fd = new FormData();
  fd.append("session_id", sessionId);
  for (const f of files) fd.append("files", f);
  const r = await fetch(`${API}/upload`, { method: "POST", body: fd });
  if (!r.ok || !r.body) throw new Error("upload failed");
  for await (const ev of readNDJSON(r)) onEvent(ev);
}
