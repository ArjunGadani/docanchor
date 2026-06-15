import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

function SourceCard({ source, active, registerRef }) {
  const ref = useRef(null);
  useEffect(() => {
    registerRef(source.id, ref.current);
  }, [source.id, registerRef]);

  const partial = source.match === "partial";
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border p-3 transition-colors ${
        active
          ? "source-pulse border-accent bg-accent-soft dark:bg-accent-softdark"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="flex h-5 min-w-5 items-center justify-center rounded bg-accent px-1 text-[11px] font-bold text-white">
            {source.id}
          </span>
          <span className="truncate text-xs font-medium text-neutral-700 dark:text-neutral-200">
            {source.doc}
          </span>
          {source.loc && (
            <span className="shrink-0 text-[11px] text-neutral-400">{source.loc}</span>
          )}
        </div>
        {partial ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            partial match
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            strong
          </span>
        )}
      </div>
      <p className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
        {/* Reveal the full passage when this source is the active citation. */}
        {active || source.text.length <= 320
          ? source.text
          : source.text.slice(0, 320) + "…"}
      </p>
    </motion.div>
  );
}

export default function SourcesPanel({
  sources,
  activeId,
  registerRef,
  mobileOpen,
  onClose,
}) {
  const hasSources = sources && sources.length > 0;

  const body = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          Sources
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-600 lg:hidden"
          aria-label="Close sources"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {hasSources ? (
          sources.map((s) => (
            <SourceCard
              key={s.id}
              source={s}
              active={activeId === s.id}
              registerRef={registerRef}
            />
          ))
        ) : (
          <p className="mt-10 px-4 text-center text-xs text-neutral-400">
            Sources for an answer will appear here. Click a{" "}
            <span className="font-semibold text-accent">[1]</span> marker to
            highlight the passage it came from.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: static right column */}
      <aside className="hidden w-80 shrink-0 border-l border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-950 lg:block">
        {body}
      </aside>

      {/* Mobile: slide-over drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-30 bg-black/30 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
            <motion.aside
              className="fixed right-0 top-0 z-40 h-full w-[85%] max-w-sm border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 lg:hidden"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 260 }}
            >
              {body}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
