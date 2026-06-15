-- DocsRAG database schema (Supabase / Postgres + pgvector).
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- The service-role key used by the backend cannot run DDL via PostgREST, so
-- this file must be applied manually once (and after any change here).

-- 1. pgvector extension -------------------------------------------------------
create extension if not exists vector;

-- 2. Tables -------------------------------------------------------------------
create table if not exists documents (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  is_demo    boolean default false,
  session_id text,
  created_at timestamptz default now()
);

create table if not exists chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  content     text,
  loc         text,
  chunk_index int,
  embedding   vector(384),
  session_id  text
);

-- 3. Indexes ------------------------------------------------------------------
-- HNSW for cosine similarity (better recall than ivfflat at this scale, and no
-- build-after-load requirement).
create index if not exists chunks_embedding_hnsw_idx
  on chunks using hnsw (embedding vector_cosine_ops);

-- Filter helpers.
create index if not exists chunks_session_idx   on chunks (session_id);
create index if not exists chunks_document_idx   on chunks (document_id);
create index if not exists documents_session_idx on documents (session_id);
create index if not exists documents_is_demo_idx on documents (is_demo);

-- 4. Retrieval RPC ------------------------------------------------------------
-- Returns the top `match_count` chunks by cosine similarity, scoped to demo
-- docs OR the caller's session. similarity = 1 - cosine_distance (higher = closer).
create or replace function match_chunks(
  query_embedding vector(384),
  match_session   text,
  match_count     int default 5
)
returns table (
  id          uuid,
  content     text,
  loc         text,
  doc         text,
  chunk_index int,
  similarity  float
)
language sql
stable
as $$
  select
    c.id,
    c.content,
    c.loc,
    d.name as doc,
    c.chunk_index,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  join documents d on d.id = c.document_id
  where d.is_demo = true or c.session_id = match_session
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function match_chunks(vector, text, int) to anon, authenticated, service_role;

-- Reload PostgREST's schema cache so the new function is callable immediately.
notify pgrst, 'reload schema';
