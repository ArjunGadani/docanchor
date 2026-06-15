import { motion } from "framer-motion";

// A clickable inline citation marker like [1].
export function CitationChip({ n, active, onClick }) {
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.18 }}
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      aria-label={`Jump to source ${n}`}
      className={`mx-[1px] inline-flex h-[18px] min-w-[18px] translate-y-[-2px] items-center justify-center rounded px-[3px] text-[10px] font-semibold leading-none transition-colors ${
        active
          ? "bg-accent text-white"
          : "bg-accent-soft text-accent hover:bg-indigo-200 dark:bg-accent-softdark dark:text-indigo-200 dark:hover:bg-indigo-800"
      }`}
    >
      {n}
    </motion.button>
  );
}

// Render answer text, turning [n] markers that map to a real source into
// clickable chips. Newlines are preserved by a whitespace-pre-wrap container.
export function renderAnswer(text, validIds, activeId, onCite) {
  const parts = [];
  const regex = /\[(\d+)\]/g;
  let last = 0;
  let m;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (validIds.has(n)) {
      parts.push(
        <CitationChip
          key={`cite-${key++}`}
          n={n}
          active={activeId === n}
          onClick={() => onCite(n)}
        />
      );
    } else {
      parts.push(m[0]);
    }
    last = regex.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
