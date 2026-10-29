-- memory.search without an embedding: case-insensitive substring match, LIKE wildcards escaped, newest first.
SELECT id, content, tags, 1.0::float8 AS score FROM memory.memories
WHERE content ILIKE '%' || replace(replace(replace($1, '\', '\\'), '%', '\%'), '_', '\_') || '%'
ORDER BY created_at DESC
LIMIT $2
