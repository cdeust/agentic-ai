-- runs.appendEvent: next event of a run, numbered from 0. An unknown run violates the foreign key (23503).
INSERT INTO run_events (run_id, seq, type, payload)
SELECT $1::uuid, COALESCE(MAX(seq) + 1, 0), $2, $3::jsonb FROM run_events WHERE run_id = $1::uuid
RETURNING run_id, seq, type, payload, at
