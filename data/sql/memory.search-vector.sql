-- memory.search with an embedding: cosine similarity through the HNSW index.
SELECT id, content, tags, (1 - (embedding <=> $1::vector))::float8 AS score FROM memory.memories
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1::vector
LIMIT $2
