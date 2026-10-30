Feature: Result schema
  The Result of an intent tool is a closed shape: a status, its data or a named error, evidence, cost and a run id.

  Scenario: accepts ok with data and failed with an error
    Then the Result schema of recall data accepts:
      """
      { "status": "ok", "data": { "summary": "s", "memories": [] }, "evidence": [], "run_id": "r1", "cost": { "input_tokens": 0, "output_tokens": 0, "usd": 0 } }
      """
    And the Result schema of recall data accepts:
      """
      { "status": "failed", "data": null, "error": { "code": "WORKER_FAILED", "message": "m" }, "evidence": [], "run_id": "r1", "cost": { "input_tokens": 0, "output_tokens": 0, "usd": 0 } }
      """
    And the Result schema of recall data accepts:
      """
      { "status": "needs_clarification", "data": null, "error": { "code": "NEEDS_CLARIFICATION", "message": "which?" }, "evidence": [], "run_id": "r1", "cost": { "input_tokens": 0, "output_tokens": 0, "usd": 0 } }
      """

  Scenario: rejects ok without data, failed without error, and unnamed causes
    Then the Result schema of recall data rejects:
      """
      { "status": "ok", "data": null, "evidence": [], "run_id": "r1", "cost": { "input_tokens": 0, "output_tokens": 0, "usd": 0 } }
      """
    And the Result schema of recall data rejects:
      """
      { "status": "failed", "data": null, "evidence": [], "run_id": "r1", "cost": { "input_tokens": 0, "output_tokens": 0, "usd": 0 } }
      """
    And the Result schema of recall data rejects:
      """
      { "status": "failed", "data": null, "error": { "code": "BECAUSE", "message": "m" }, "evidence": [], "run_id": "r1", "cost": { "input_tokens": 0, "output_tokens": 0, "usd": 0 } }
      """

  Scenario: allows a null run_id only as a value, never a missing field
    Then the Result schema of recall data rejects:
      """
      { "status": "failed", "data": null, "evidence": [], "cost": { "input_tokens": 0, "output_tokens": 0, "usd": 0 }, "error": { "code": "INVALID_INPUT", "message": "m" } }
      """
    And the Result schema of recall data accepts:
      """
      { "status": "failed", "data": null, "evidence": [], "run_id": null, "cost": { "input_tokens": 0, "output_tokens": 0, "usd": 0 }, "error": { "code": "INVALID_INPUT", "message": "m" } }
      """
