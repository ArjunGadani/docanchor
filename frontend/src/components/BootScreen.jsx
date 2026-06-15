import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { IconAnchor } from "./icons.jsx";

const MESSAGES = [
  "Waking the engine…",
  "Loading the model…",
  "Connecting to the knowledge base…",
  "Almost ready…",
];

// Full-screen animated boot cover shown while the backend cold-starts on
// Render's free tier (first request after sleep can take ~30-60s).
export default function BootScreen() {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setMsgIndex((i) => (i + 1) % MESSAGES.length),
      2000
    );
    return () => clearInterval(id);
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6 dark:bg-neutral-950"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        className="relative h-20 w-20"
        animate={{ scale: [1, 1.12, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <div className="absolute inset-0 rounded-full bg-accent opacity-20 blur-xl" />
        <div className="absolute inset-2 flex items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-accent shadow-lg">
          <IconAnchor className="h-7 w-7 text-white" strokeWidth={2.2} />
        </div>
      </motion.div>

      <h1 className="mt-8 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        DocAnchor
      </h1>

      <motion.p
        key={msgIndex}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-2 h-5 text-sm text-neutral-500 dark:text-neutral-400"
      >
        {MESSAGES[msgIndex]}
      </motion.p>

      {/* shimmer progress bar */}
      <div className="relative mt-6 h-1 w-56 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className="animate-shimmer absolute inset-y-0 w-1/3 rounded-full bg-accent" />
      </div>

      <p className="mt-6 max-w-xs text-center text-xs text-neutral-400 dark:text-neutral-600">
        First load can take up to a minute on free hosting.
      </p>
    </motion.div>
  );
}
