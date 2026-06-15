import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { renderAnswer } from "../lib/render.jsx";
import { BEST_MODEL, MODELS } from "../models";
import { IconCopy, IconCheck, IconRefresh } from "./icons.jsx";

function modelLabel(id) {
  if (id === MODELS.fast.id) return "Fast";
  if (id === MODELS.best.id) return "Best";
  return id || "";
}

// Reveals text progressively for a live "typing" feel, independent of how the
// network delivers chunks. Returns the visible slice + whether it's still
// revealing, so the caller can hold the footer until typing finishes.
function useTypewriter(fullText, streaming) {
  const [shown, setShown] = useState(streaming ? 0 : fullText.length);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    let raf;
    const loop = () => {
      const s = shownRef.current;
      if (s >= fullText.length) return;
      const remaining = fullText.length - s;
      setShown(Math.min(fullText.length, s + Math.max(2, Math.ceil(remaining / 6))));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fullText]);

  const revealing = streaming || shown < fullText.length;
  let visible = revealing ? fullText.slice(0, shown) : fullText;
  if (revealing) visible = visible.replace(/\[\d*$/, ""); // hide half-typed [1
  return { visible, revealing };
}

function AnswerMeta({ message, onRegenerate }) {
  const [copied, setCopied] = useState(false);
  const hasContent = !!message.content?.trim();
  const showStats = message.grounding && message.grounding !== "none";
  // Retry only makes sense on a real grounded answer that wasn't already 70B.
  const canRetry = showStats && message.question && message.model && message.model !== BEST_MODEL;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  // Nothing useful to show (e.g. empty content, no stats) → render nothing.
  if (!showStats && !hasContent) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
      {showStats && (
        <>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium ${
              message.grounding === "high"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}
          >
            {message.grounding === "high" ? "High grounding" : "Partial grounding"}
          </span>
          <span>
            {modelLabel(message.model)}
            {typeof message.nSources === "number" ? ` · ${message.nSources} sources` : ""}
            {typeof message.latencyMs === "number" ? ` · ${(message.latencyMs / 1000).toFixed(1)}s` : ""}
          </span>
        </>
      )}
      <div className="ml-auto flex items-center gap-2">
        {hasContent && (
          <button onClick={copy} className="inline-flex items-center gap-1 hover:text-neutral-700 dark:hover:text-neutral-200">
            {copied ? <IconCheck className="h-3 w-3" /> : <IconCopy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        {canRetry && (
          <button
            onClick={() => onRegenerate(message.id, message.question)}
            className="inline-flex items-center gap-1 hover:text-accent"
            title="Re-answer with the 70B model"
          >
            <IconRefresh className="h-3 w-3" />
            Retry with Best
          </button>
        )}
      </div>
    </div>
  );
}

export default function MessageBubble({ message, activeSourceId, onCite, onFollowup, onRegenerate }) {
  const isUser = message.role === "user";
  const validIds = new Set((message.sources || []).map((s) => s.id));
  const { visible, revealing } = useTypewriter(message.content || "", !!message.streaming);

  // Footer + follow-ups only once the answer is fully typed out.
  const showFooter = !isUser && !message.streaming && !revealing && !message.error;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%] ${
          isUser
            ? "bg-accent text-white"
            : "border border-neutral-200 bg-white text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <div className="whitespace-pre-wrap break-words">
            {renderAnswer(visible, validIds, activeSourceId, (n) => onCite(message.id, n))}
            {revealing && (
              <motion.span
                className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-[2px] bg-accent align-middle"
                animate={{ opacity: [1, 0.2, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
            )}
          </div>
        )}

        {message.limited && (
          <a
            href="https://console.groq.com/keys"
            target="_blank"
            rel="noreferrer"
            className={`mt-1 inline-block text-xs underline ${isUser ? "text-indigo-100" : "text-accent"}`}
          >
            Get a free Groq key →
          </a>
        )}
      </div>

      {showFooter && (
        <div className="w-full max-w-[85%] sm:max-w-[75%]">
          <AnswerMeta message={message} onRegenerate={onRegenerate} />
          {message.suggestions?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.suggestions.map((q, i) => (
                <button
                  key={`${i}-${q}`}
                  onClick={() => onFollowup(q)}
                  className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:border-accent hover:text-accent dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
