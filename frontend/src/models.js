// Must match the backend's primary/fallback model ids (config.py).
export const MODELS = {
  fast: {
    id: "llama-3.1-8b-instant",
    label: "Fast",
    hint: "Llama 3.1 8B — quick, great for most questions",
  },
  best: {
    id: "llama-3.3-70b-versatile",
    label: "Best",
    hint: "Llama 3.3 70B — stronger reasoning & grey-area hedging",
  },
};

export const DEFAULT_MODEL = MODELS.fast.id;
export const BEST_MODEL = MODELS.best.id;
