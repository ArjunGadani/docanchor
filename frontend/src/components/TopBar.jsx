import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MODELS } from "../models";
import {
  BrandMark,
  IconFile,
  IconKey,
  IconMoon,
  IconPanel,
  IconReset,
  IconSun,
  IconUpload,
} from "./icons.jsx";

function IconButton({ title, onClick, children, active }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors ${
        active
          ? "border-accent bg-accent-soft text-accent dark:border-accent dark:bg-accent-softdark dark:text-indigo-200"
          : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

export default function TopBar({
  model,
  setModel,
  onOpenUpload,
  onOpenDocs,
  scopeCount = 0,
  userApiKey,
  setUserApiKey,
  theme,
  toggleTheme,
  onReset,
  onToggleSources,
  hasSources,
}) {
  const [keyOpen, setKeyOpen] = useState(false);

  return (
    <header className="z-20 flex items-center justify-between gap-2 border-b border-neutral-200 bg-white/80 px-3 py-2.5 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80 sm:px-4">
      <div className="flex items-center gap-2">
        <BrandMark className="h-6 w-6" />
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          DocAnchor
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {/* Model switcher */}
        <div className="flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
          {Object.values(MODELS).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setModel(m.id)}
              title={m.hint}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                model === m.id
                  ? "bg-accent text-white"
                  : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <IconButton title="Upload documents" onClick={onOpenUpload}>
          <IconUpload className="h-4 w-4" />
          <span className="hidden sm:inline">Upload</span>
        </IconButton>

        <IconButton title="Manage documents" onClick={onOpenDocs} active={scopeCount > 0}>
          <IconFile className="h-4 w-4" />
          <span className="hidden sm:inline">Docs{scopeCount > 0 ? ` (${scopeCount})` : ""}</span>
        </IconButton>

        <div className="relative">
          <IconButton
            title="Use your own Groq API key"
            onClick={() => setKeyOpen((o) => !o)}
            active={!!userApiKey}
          >
            <IconKey className="h-4 w-4" />
            <span className="hidden sm:inline">{userApiKey ? "Key set" : "Own key"}</span>
          </IconButton>
          <AnimatePresence>
            {keyOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                className="absolute right-0 top-11 z-30 w-72 rounded-xl border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
              >
                <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
                  Paste your own Groq key to skip shared limits. It stays in this
                  browser tab only — never stored or logged.
                </p>
                <input
                  type="password"
                  value={userApiKey}
                  onChange={(e) => setUserApiKey(e.target.value.trim())}
                  placeholder="gsk_…"
                  className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-700 dark:bg-neutral-800"
                />
                <div className="mt-2 flex items-center justify-between">
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent hover:underline"
                  >
                    Get a free key →
                  </a>
                  {userApiKey && (
                    <button
                      type="button"
                      onClick={() => setUserApiKey("")}
                      className="text-xs text-neutral-400 hover:text-neutral-600"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <IconButton title="Reset to demo documents" onClick={onReset}>
          <IconReset className="h-4 w-4" />
        </IconButton>

        <IconButton
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
        </IconButton>

        {hasSources && (
          <span className="lg:hidden">
            <IconButton title="Toggle sources" onClick={onToggleSources}>
              <IconPanel className="h-4 w-4" />
            </IconButton>
          </span>
        )}
      </div>
    </header>
  );
}
