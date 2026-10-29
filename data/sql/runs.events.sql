-- runs.events: the events of a run in order, as one JSON array. No row: unknown run.
SELECT COALESCE(
         json_agg(json_build_object('run_id', e.run_id, 'seq', e.seq, 'type', e.type, 'payload', e.payload, 'at', e.at)
                  ORDER BY e.seq) FILTER (WHERE e.seq IS NOT NULL),
         '[]'::json) AS value
FROM runs r LEFT JOIN run_events e ON e.run_id = r.id
WHERE r.id = $1::uuid
GROUP BY r.id
