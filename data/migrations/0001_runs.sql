-- 0001: registry of executions (runs) and their ordered events.
CREATE TABLE runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service      text NOT NULL,
  tool         text NOT NULL,
  input        jsonb NOT NULL,
  status       text NOT NULL CHECK (status IN ('running', 'ok', 'needs_clarification', 'failed')),
  result       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE run_events (
  run_id  uuid NOT NULL REFERENCES runs (id),
  seq     integer NOT NULL,
  type    text NOT NULL CHECK (type IN (
    'run.created', 'worker.started', 'worker.exited',
    'output.validated', 'output.invalid', 'run.completed'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);

CREATE INDEX runs_service_tool_idx ON runs (service, tool, created_at DESC);
