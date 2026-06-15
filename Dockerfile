# syntax=docker/dockerfile:1
# DocsRAG — single image: build the React SPA, then serve it + the API from one
# Python process. Sized for Render's free tier (512MB RAM / ~0.1 CPU).

# --- Stage 1: build the frontend ---------------------------------------------
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stage 2: python runtime -------------------------------------------------
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    EMBEDDING_CACHE_DIR=/app/models \
    STATIC_DIR=/app/frontend/dist

WORKDIR /app

# Python deps first (better layer caching)
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Backend source + DB schema (schema.sql is read by the optional auto-migration)
COPY backend/ ./
COPY db/ ./db/

# Bake the embedding model into the image so there is NO download on cold start
# (Render's disk is ephemeral; a runtime download would repeat every wake).
# Retry with backoff so a transient Hugging Face rate-limit doesn't fail the
# whole deploy; exit non-zero only if every attempt fails.
RUN python - <<'PY'
import sys, time
from fastembed import TextEmbedding
for i in range(5):
    try:
        TextEmbedding(model_name='BAAI/bge-small-en-v1.5', cache_dir='/app/models')
        print('embedding model baked')
        sys.exit(0)
    except Exception as e:
        print(f'bake attempt {i + 1}/5 failed: {e}', flush=True)
        time.sleep(10)
sys.exit(1)
PY

# Built SPA from stage 1
COPY --from=frontend /app/frontend/dist /app/frontend/dist

EXPOSE 8000
# Single worker — memory-bound free tier. Render injects $PORT.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
