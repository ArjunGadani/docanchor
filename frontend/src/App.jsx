import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import BootScreen from "./components/BootScreen.jsx";
import TopBar from "./components/TopBar.jsx";
import ChatView from "./components/ChatView.jsx";
import SourcesPanel from "./components/SourcesPanel.jsx";
import UploadModal from "./components/UploadModal.jsx";
import DocManager from "./components/DocManager.jsx";
import { BEST_MODEL, DEFAULT_MODEL } from "./models";
import { deleteDoc, getHealth, getSessionDocs, resetSession, streamChat } from "./api";

function getSessionId() {
  let id = localStorage.getItem("docsrag_session");
  if (!id) {
    id =
      crypto.randomUUID?.() ||
      `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("docsrag_session", id);
  }
  return id;
}

let MSG_SEQ = 0;
const nextId = () => `m${++MSG_SEQ}`;

const chatKey = (sid) => `docsrag_chat_${sid}`;
const scopeKey = (sid) => `docsrag_scope_${sid}`;

function loadScope() {
  try {
    const arr = JSON.parse(localStorage.getItem(scopeKey(getSessionId())) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Restore the chat thread for this session from localStorage so a browser
// refresh keeps the conversation (the session_id, and thus uploaded docs,
// already persist). Streaming flags are cleared and the id counter is advanced
// past restored ids so new messages don't collide.
function loadChat() {
  try {
    const raw = localStorage.getItem(chatKey(getSessionId()));
    if (!raw) return [];
    const msgs = JSON.parse(raw);
    if (!Array.isArray(msgs)) return [];
    const maxN = msgs.reduce((mx, m) => {
      const n = parseInt(String(m.id).replace(/^m/, ""), 10);
      return Number.isNaN(n) ? mx : Math.max(mx, n);
    }, 0);
    if (maxN > MSG_SEQ) MSG_SEQ = maxN;
    return msgs.map((m) => ({ ...m, streaming: false }));
  } catch {
    return [];
  }
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("docsrag_theme") || "light");
  const [sessionId] = useState(getSessionId);

  const [messages, setMessages] = useState(loadChat);
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [userApiKey, setUserApiKey] = useState("");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [docManagerOpen, setDocManagerOpen] = useState(false);
  const [sourcesMobileOpen, setSourcesMobileOpen] = useState(false);
  const [sessionDocs, setSessionDocs] = useState({ docs: [], has_uploads: false, all_docs: [] });
  const [selectedDocs, setSelectedDocs] = useState(loadScope); // [] = search all docs

  const [activeMessageId, setActiveMessageId] = useState(null);
  const [activeSourceId, setActiveSourceId] = useState(null);
  const sourceRefs = useRef({});

  // --- Theme ---
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("docsrag_theme", theme);
  }, [theme]);

  // --- Boot: poll health until ready ---
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        await getHealth();
        if (!cancelled) setBooted(true);
      } catch {
        if (!cancelled) setTimeout(poll, 2000);
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Load session docs once booted ---
  const refreshDocs = useCallback(async () => {
    try {
      setSessionDocs(await getSessionDocs(sessionId));
    } catch {
      /* transient failure — keep the previous doc list rather than blanking it */
    }
  }, [sessionId]);

  useEffect(() => {
    if (booted) refreshDocs();
  }, [booted, refreshDocs]);

  // --- Persist chat per session so a refresh keeps the conversation ---
  useEffect(() => {
    if (sending) return; // don't persist mid-stream partials
    try {
      localStorage.setItem(chatKey(sessionId), JSON.stringify(messages));
    } catch {
      /* storage full/unavailable — non-fatal */
    }
  }, [messages, sending, sessionId]);

  // Persist the document scope per session (survives refresh, like the chat).
  useEffect(() => {
    try {
      localStorage.setItem(scopeKey(sessionId), JSON.stringify(selectedDocs));
    } catch {
      /* non-fatal */
    }
  }, [selectedDocs, sessionId]);

  // Drop any scoped doc that no longer exists (deleted, or stale from storage).
  useEffect(() => {
    const all = sessionDocs.all_docs;
    if (!all) return;
    setSelectedDocs((cur) => {
      const pruned = cur.filter((d) => all.includes(d));
      return pruned.length === cur.length ? cur : pruned;
    });
  }, [sessionDocs.all_docs]);

  // On first load, point the sources panel at the most recent restored answer.
  useEffect(() => {
    const last = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.sources?.length);
    if (last) setActiveMessageId(last.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Cross-highlight: scroll to the active source card ---
  useEffect(() => {
    if (activeSourceId == null) return;
    const node = sourceRefs.current[activeSourceId];
    if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeSourceId, activeMessageId]);

  const registerRef = useCallback((id, node) => {
    if (node) sourceRefs.current[id] = node;
  }, []);

  const onCite = useCallback((messageId, n) => {
    setActiveMessageId(messageId);
    setActiveSourceId(n);
    setSourcesMobileOpen(true);
  }, []);

  // --- Send a message ---
  // opts.model overrides the model; opts.replaceId regenerates an existing
  // answer in place (used by "Retry with Best"), using the history as of that
  // message rather than the full current thread.
  const send = useCallback(
    async (text, opts = {}) => {
      if (sending) return;
      const useModel = opts.model || model;
      const replaceIdx = opts.replaceId
        ? messages.findIndex((m) => m.id === opts.replaceId)
        : -1;

      // History = real answers before this turn (exclude errors/invites). When
      // regenerating in place, only consider messages before the target.
      const scope = replaceIdx >= 0 ? messages.slice(0, replaceIdx) : messages;
      const history = scope
        .filter((m) => !m.streaming && !m.error && !m.limited)
        .map((m) => ({ role: m.role, content: m.content }));

      let assistantId;
      if (replaceIdx >= 0) {
        assistantId = opts.replaceId;
        // Reset the target answer in place and re-stream into it.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  id: assistantId,
                  role: "assistant",
                  content: "",
                  sources: [],
                  streaming: true,
                  question: text,
                }
              : m
          )
        );
      } else {
        const newMsgs = [{ id: nextId(), role: "user", content: text }];
        assistantId = nextId();
        newMsgs.push({
          id: assistantId,
          role: "assistant",
          content: "",
          sources: [],
          streaming: true,
          question: text, // remembered so "Retry with Best" can re-ask it
        });
        setMessages((prev) => [...prev, ...newMsgs]);
      }
      setSending(true);
      const startedAt = Date.now();

      const patch = (fn) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      try {
        await streamChat(
          {
            message: text,
            history,
            model: useModel,
            userApiKey,
            sessionId,
            docs: selectedDocs,
          },
          (ev) => {
            if (ev.type === "sources") {
              patch((m) => ({ ...m, sources: ev.sources }));
              if (ev.sources.length) setActiveMessageId(assistantId);
            } else if (ev.type === "delta") {
              patch((m) => ({ ...m, content: m.content + ev.text }));
            } else if (ev.type === "suggestions") {
              patch((m) => ({ ...m, suggestions: ev.items }));
            } else if (ev.type === "done") {
              patch((m) => ({
                ...m,
                streaming: false,
                limited: !!ev.limited,
                model: ev.model || useModel,
                grounding: ev.grounding,
                nSources: ev.n_sources,
                latencyMs: Date.now() - startedAt,
              }));
            } else if (ev.type === "error") {
              // Preserve any already-streamed text; only fall back to the error
              // string if nothing was streamed yet.
              patch((m) => ({
                ...m,
                streaming: false,
                error: true,
                content: m.content || ev.detail,
              }));
            }
          }
        );
      } catch {
        patch((m) => ({
          ...m,
          streaming: false,
          error: true,
          content:
            m.content ||
            "Something went wrong reaching the assistant. Please try again.",
        }));
      } finally {
        patch((m) => ({ ...m, streaming: false }));
        setSending(false);
      }
    },
    [messages, model, userApiKey, sessionId, sending, selectedDocs]
  );

  const regenerateBest = useCallback(
    (messageId, question) => send(question, { model: BEST_MODEL, replaceId: messageId }),
    [send]
  );

  const handleReset = useCallback(async () => {
    // Clear the visible conversation + persisted thread, then drop the
    // session's uploaded docs server-side and refresh the loaded-docs note.
    setMessages([]);
    setActiveMessageId(null);
    setActiveSourceId(null);
    setSelectedDocs([]);
    try {
      localStorage.removeItem(chatKey(sessionId));
    } catch {
      /* non-fatal */
    }
    await resetSession(sessionId);
    await refreshDocs();
  }, [sessionId, refreshDocs]);

  // Sources shown in the panel = the active message's (defaults to latest answer).
  const activeMsg = messages.find((m) => m.id === activeMessageId);
  const activeSources = activeMsg?.sources || [];

  return (
    <div className="flex h-full flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <AnimatePresence>{!booted && <BootScreen />}</AnimatePresence>

      <TopBar
        model={model}
        setModel={setModel}
        onOpenUpload={() => setUploadOpen(true)}
        onOpenDocs={() => setDocManagerOpen(true)}
        scopeCount={selectedDocs.length}
        userApiKey={userApiKey}
        setUserApiKey={setUserApiKey}
        theme={theme}
        toggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        onReset={handleReset}
        onToggleSources={() => setSourcesMobileOpen((o) => !o)}
        hasSources={activeSources.length > 0}
      />

      <div className="flex min-h-0 flex-1">
        <ChatView
          messages={messages}
          onSend={send}
          onRegenerate={regenerateBest}
          sending={sending}
          activeMessageId={activeMessageId}
          activeSourceId={activeSourceId}
          onCite={onCite}
          sessionDocs={sessionDocs}
          selectedDocs={selectedDocs}
          onReset={handleReset}
        />
        <SourcesPanel
          sources={activeSources}
          activeId={activeSourceId}
          registerRef={registerRef}
          mobileOpen={sourcesMobileOpen}
          onClose={() => setSourcesMobileOpen(false)}
        />
      </div>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        sessionId={sessionId}
        onComplete={refreshDocs}
      />

      <DocManager
        open={docManagerOpen}
        onClose={() => setDocManagerOpen(false)}
        sessionId={sessionId}
        allDocs={sessionDocs.all_docs || []}
        uploadedDocs={sessionDocs.docs || []}
        selectedDocs={selectedDocs}
        setSelectedDocs={setSelectedDocs}
        onDelete={async (name) => {
          await deleteDoc(sessionId, name);
          setSelectedDocs((d) => d.filter((x) => x !== name));
          await refreshDocs();
        }}
      />
    </div>
  );
}
