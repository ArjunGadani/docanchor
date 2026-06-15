import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ingestUrl, streamUpload } from "../api";
import { IconCheck, IconLink, IconSpinner, IconUpload, IconX } from "./icons.jsx";

const STAGES = [
  { key: "uploading", label: "Uploading" },
  { key: "extracting", label: "Extracting text" },
  { key: "chunking", label: "Chunking" },
  { key: "embedding", label: "Embedding" },
  { key: "storing", label: "Storing" },
  { key: "done", label: "Done" },
];
const ORDER = STAGES.map((s) => s.key);
const ACCEPT = ".pdf,.txt,.docx,.md,.markdown";

export default function UploadModal({ open, onClose, sessionId, onComplete }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [current, setCurrent] = useState(null); // {stage, detail, pct, file, doc}
  const [results, setResults] = useState([]); // [{doc, status, chunks, detail}]
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const inputRef = useRef(null);

  const reset = () => {
    setFiles([]);
    setCurrent(null);
    setResults([]);
    setUploading(false);
  };

  const close = () => {
    if (uploading) return;
    reset();
    onClose();
  };

  const addFiles = (list) => {
    const arr = Array.from(list || []);
    if (arr.length) setFiles((f) => [...f, ...arr]);
  };

  const start = async () => {
    if (!files.length) return;
    setUploading(true);
    setResults([]);
    const collected = [];
    try {
      await streamUpload({ files, sessionId }, (ev) => {
        setCurrent(ev);
        if (ev.stage === "done") {
          collected.push({ doc: ev.doc, status: "done", chunks: ev.chunks });
          setResults([...collected]);
        } else if (ev.stage === "error") {
          collected.push({ doc: ev.doc, status: "error", detail: ev.detail });
          setResults([...collected]);
        }
      });
    } catch {
      setCurrent({ stage: "error", detail: "Upload failed. Please try again." });
    }
    setUploading(false);
    setCurrent(null);
    setFiles([]);
    onComplete();
  };

  const startUrl = async () => {
    const u = url.trim();
    if (!u) return;
    setUploading(true);
    setResults([]);
    const collected = [];
    try {
      await ingestUrl({ url: u, sessionId }, (ev) => {
        setCurrent(ev);
        if (ev.stage === "done") {
          collected.push({ doc: ev.doc, status: "done", chunks: ev.chunks });
          setResults([...collected]);
        } else if (ev.stage === "error") {
          collected.push({ doc: ev.doc, status: "error", detail: ev.detail });
          setResults([...collected]);
        }
      });
    } catch {
      setCurrent({ stage: "error", detail: "Could not fetch that URL." });
    }
    setUploading(false);
    setCurrent(null);
    setUrl("");
    onComplete();
  };

  // "file" (batch boundary) and "fetching" (URL download) aren't stepper stages;
  // map them to the first step rather than letting indexOf return -1 (inert).
  const activeIndex = current
    ? current.stage === "file" || current.stage === "fetching"
      ? 0
      : ORDER.indexOf(current.stage)
    : -1;

  // AnimatePresence must stay mounted and gate its child on `open`, otherwise
  // the exit animation never plays (early-returning null unmounts it).
  return (
    <AnimatePresence>
      {open && (
      <motion.div
        key="upload-overlay"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={close}
      >
        <motion.div
          className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900"
          initial={{ scale: 0.95, y: 12 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 12 }}
          transition={{ type: "spring", damping: 26, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              Upload documents
            </h2>
            {!uploading && (
              <button onClick={close} className="text-neutral-400 hover:text-neutral-600" aria-label="Close">
                <IconX className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Idle: dropzone + selected files */}
          {!uploading && !results.length && (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  addFiles(e.dataTransfer.files);
                }}
                onClick={() => inputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
                  dragOver
                    ? "border-accent bg-accent-soft dark:bg-accent-softdark"
                    : "border-neutral-300 hover:border-accent dark:border-neutral-700"
                }`}
              >
                <IconUpload className="h-7 w-7 text-neutral-400" />
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                  Drag &amp; drop or <span className="text-accent">browse</span>
                </p>
                <p className="mt-1 text-xs text-neutral-400">PDF, TXT, DOCX, MD · up to 10 MB each</p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />
              </div>

              {files.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {files.map((f, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between rounded-lg bg-neutral-100 px-2.5 py-1.5 text-xs dark:bg-neutral-800"
                    >
                      <span className="truncate text-neutral-700 dark:text-neutral-200">{f.name}</span>
                      <button
                        onClick={() => setFiles((arr) => arr.filter((_, j) => j !== i))}
                        className="ml-2 text-neutral-400 hover:text-red-500"
                        aria-label="Remove"
                      >
                        <IconX className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <button
                onClick={start}
                disabled={!files.length}
                className="mt-4 w-full rounded-lg bg-accent py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
              >
                Ingest {files.length > 0 ? `${files.length} file${files.length > 1 ? "s" : ""}` : ""}
              </button>

              <div className="my-3 flex items-center gap-2 text-xs text-neutral-400">
                <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                or add a web page
                <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
              </div>
              <div className="flex gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-lg border border-neutral-200 px-2.5 dark:border-neutral-700">
                  <IconLink className="h-4 w-4 shrink-0 text-neutral-400" />
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && startUrl()}
                    placeholder="https://…"
                    className="w-full bg-transparent py-1.5 text-sm outline-none"
                  />
                </div>
                <button
                  onClick={startUrl}
                  disabled={!url.trim()}
                  className="shrink-0 rounded-lg border border-neutral-200 px-3 text-sm font-medium text-neutral-600 transition-colors hover:border-accent hover:text-accent disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300"
                >
                  Add
                </button>
              </div>
            </>
          )}

          {/* In progress: stepper */}
          {uploading && (
            <div className="py-2">
              {current?.file && (
                <p className="mb-3 text-xs font-medium text-neutral-500">Processing file {current.file}</p>
              )}
              <ol className="space-y-2">
                {STAGES.map((stage, i) => {
                  const done = i < activeIndex || (current?.stage === "done" && stage.key === "done");
                  const active = i === activeIndex && current?.stage !== "done";
                  return (
                    <li key={stage.key} className="flex items-center gap-2.5 text-sm">
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                          done
                            ? "bg-emerald-500 text-white"
                            : active
                              ? "bg-accent text-white"
                              : "bg-neutral-200 text-neutral-400 dark:bg-neutral-700"
                        }`}
                      >
                        {done ? (
                          <IconCheck className="h-3 w-3" />
                        ) : active ? (
                          <IconSpinner className="h-3 w-3" />
                        ) : (
                          i + 1
                        )}
                      </span>
                      <span className={active ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-500"}>
                        {stage.label}
                        {active && current?.detail ? ` — ${current.detail}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
              {current?.stage === "embedding" && typeof current.pct === "number" && (
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                  <motion.div
                    className="h-full rounded-full bg-accent"
                    animate={{ width: `${current.pct}%` }}
                    transition={{ duration: 0.2 }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Results */}
          {!uploading && results.length > 0 && (
            <div className="py-1">
              <ul className="space-y-1.5">
                {results.map((r, i) => (
                  <li
                    key={i}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                      r.status === "done"
                        ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                        : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200"
                    }`}
                  >
                    <span className="truncate">{r.doc}</span>
                    <span className="ml-2 shrink-0 text-xs">
                      {r.status === "done" ? `✓ ${r.chunks} chunks` : `✕ ${r.detail || "failed"}`}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                onClick={close}
                className="mt-4 w-full rounded-lg bg-accent py-2 text-sm font-medium text-white"
              >
                Done
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
