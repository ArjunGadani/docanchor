import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import MessageBubble from "./MessageBubble.jsx";
import { BrandMark, IconMic, IconSend, IconSpinner } from "./icons.jsx";

const SpeechRec =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

const EXAMPLES = [
  "How many casual leaves do I get?",
  "What's the notice period during probation?",
  "Summarize the code of conduct",
];

function EmptyState({ sessionDocs, onExample, onReset }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center">
      <BrandMark className="mb-4 h-12 w-12" rounded="rounded-xl" />
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        Ask your documents
      </h1>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        DocsRAG answers only from the loaded documents, with citations you can
        click. No hallucinations.
      </p>

      {sessionDocs?.has_uploads ? (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-neutral-600 dark:text-neutral-300">
            Your uploaded documents are still loaded:
          </p>
          <p className="mt-1 font-medium text-neutral-800 dark:text-neutral-100">
            {sessionDocs.docs.join(", ")}
          </p>
          <button onClick={onReset} className="mt-2 text-xs text-accent hover:underline">
            Reset to demo documents
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-neutral-400">
          Loaded demo set: employee handbook, leave policy, code of conduct.
        </p>
      )}

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => onExample(ex)}
            className="rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-xs text-neutral-600 transition-colors hover:border-accent hover:text-accent dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ChatView({
  messages,
  onSend,
  onRegenerate,
  sending,
  activeMessageId,
  activeSourceId,
  onCite,
  sessionDocs,
  selectedDocs = [],
  onReset,
}) {
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Stop any in-flight recognition when ChatView unmounts (avoids a stuck mic
  // and setState-after-unmount).
  useEffect(() => () => recognitionRef.current?.stop(), []);

  const toggleMic = () => {
    if (!SpeechRec) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new SpeechRec();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    // Append to whatever is already typed instead of replacing it.
    const base = input.trim() ? input.trim() + " " : "";
    rec.onresult = (e) => {
      const t = Array.from(e.results).map((r) => r[0].transcript).join("");
      setInput(base + t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  const submit = () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    onSend(text);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyState sessionDocs={sessionDocs} onExample={onSend} onReset={onReset} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                activeSourceId={activeMessageId === m.id ? activeSourceId : null}
                onCite={onCite}
                onFollowup={onSend}
                onRegenerate={onRegenerate}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-neutral-200 bg-white/80 px-3 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80 sm:px-4">
        {selectedDocs.length > 0 && (
          <div className="mx-auto mb-1.5 max-w-3xl text-xs text-accent">
            Scoped to {selectedDocs.length} document{selectedDocs.length > 1 ? "s" : ""}
          </div>
        )}
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask about the documents…"
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-accent dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
          />
          {SpeechRec && (
            <button
              onClick={toggleMic}
              title={listening ? "Stop" : "Speak"}
              aria-label="Voice input"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                listening
                  ? "border-accent bg-accent text-white"
                  : "border-neutral-200 text-neutral-500 hover:border-accent hover:text-accent dark:border-neutral-800"
              }`}
            >
              <IconMic className="h-5 w-5" />
            </button>
          )}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={submit}
            disabled={sending || !input.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition-opacity disabled:opacity-40"
            aria-label="Send"
          >
            {sending ? <IconSpinner className="h-5 w-5" /> : <IconSend className="h-5 w-5" />}
          </motion.button>
        </div>
      </div>
    </div>
  );
}
