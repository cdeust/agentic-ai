-- 0002: memory schema with pgvector. The vector dimension (384) must match EMBEDDING_DIMENSION in src/domain/ports.ts.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA memory;

CREATE TABLE memory.memories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content    text NOT NULL,
  tags       text[] NOT NULL DEFAULT '{}',
  embedding  vector(384),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memories_embedding_idx ON memory.memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX memories_tags_idx ON memory.memories USING gin (tags);
