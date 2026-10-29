-- runs.create: register a new execution in state running.
INSERT INTO runs (service, tool, input, status)
VALUES ($1, $2, COALESCE($3::jsonb, 'null'::jsonb), 'running')
RETURNING id, service, tool, input, status, result, created_at, completed_at
