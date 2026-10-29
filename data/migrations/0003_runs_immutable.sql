-- 0003: a completed run is immutable. Completing it again raises 55000 (object_not_in_prerequisite_state),
-- which sql/operations.json maps to INVALID_OPERATION.
CREATE FUNCTION runs_refuse_update_of_completed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'run % is already %', OLD.id, OLD.status USING ERRCODE = 'object_not_in_prerequisite_state';
END
$$;

CREATE TRIGGER runs_completed_are_immutable
  BEFORE UPDATE ON runs
  FOR EACH ROW WHEN (OLD.status <> 'running')
  EXECUTE FUNCTION runs_refuse_update_of_completed();
