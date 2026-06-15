import { AnimatePresence, motion } from "framer-motion";
import { IconFile, IconTrash, IconX } from "./icons.jsx";

// Lists every loaded document (demo + uploads). Checkboxes scope retrieval to
// the selected docs ([] = search everything). Uploaded docs can be deleted.
export default function DocManager({
  open,
  onClose,
  allDocs,
  uploadedDocs,
  selectedDocs,
  setSelectedDocs,
  onDelete,
}) {
  const uploadedSet = new Set(uploadedDocs);

  const toggle = (name) =>
    setSelectedDocs((d) =>
      d.includes(name) ? d.filter((x) => x !== name) : [...d, name]
    );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900"
            initial={{ scale: 0.95, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 12 }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Documents
              </h2>
              <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600" aria-label="Close">
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
              {selectedDocs.length
                ? `Answers scoped to ${selectedDocs.length} selected document${selectedDocs.length > 1 ? "s" : ""}.`
                : "Searching all documents. Tick boxes to scope answers."}
            </p>

            <ul className="max-h-72 space-y-1.5 overflow-y-auto">
              {allDocs.length === 0 && (
                <li className="px-1 py-6 text-center text-xs text-neutral-400">No documents loaded.</li>
              )}
              {allDocs.map((name) => {
                const isUploaded = uploadedSet.has(name);
                const checked = selectedDocs.includes(name);
                return (
                  <li
                    key={name}
                    className="flex items-center gap-2.5 rounded-lg border border-neutral-200 px-2.5 py-2 text-sm dark:border-neutral-800"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(name)}
                      className="h-4 w-4 shrink-0 accent-indigo-500"
                      aria-label={`Scope to ${name}`}
                    />
                    <IconFile className="h-4 w-4 shrink-0 text-neutral-400" />
                    <span className="flex-1 truncate text-neutral-700 dark:text-neutral-200">{name}</span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        isUploaded
                          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                          : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
                      }`}
                    >
                      {isUploaded ? "uploaded" : "demo"}
                    </span>
                    {isUploaded && (
                      <button
                        onClick={() => onDelete(name)}
                        className="shrink-0 text-neutral-400 hover:text-red-500"
                        aria-label={`Delete ${name}`}
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => setSelectedDocs([])}
                disabled={!selectedDocs.length}
                className="text-xs text-neutral-500 hover:text-neutral-800 disabled:opacity-40 dark:text-neutral-400"
              >
                Clear scope
              </button>
              <button
                onClick={onClose}
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white"
              >
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
