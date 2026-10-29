-- memory.insert: store one memory; the embedding is optional.
INSERT INTO memory.memories (content, tags, embedding) VALUES ($1, $2::text[], $3::vector) RETURNING id
