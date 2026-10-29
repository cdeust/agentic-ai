-- runs.complete: record the outcome. No row: unknown run. A completed run is refused by the
-- trigger of migrations/0003_runs_immutable.sql (55000).
UPDATE runs SET status = $2, result = $3::jsonb, completed_at = now()
WHERE id = $1::uuid
RETURNING id, service, tool, input, status, result, created_at, completed_at
