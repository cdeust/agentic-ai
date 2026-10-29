-- runs.get: one run. No row: unknown run.
SELECT id, service, tool, input, status, result, created_at, completed_at FROM runs WHERE id = $1::uuid
