Feature: End to end: client -> gateway -> memory -> worker -> data
  The whole call path in one process: real MCP between client, gateway and memory, an in-process runner executing
  the real worker core with a scripted agent, and the real data component with in-memory repositories behind its
  HTTP API. No container, no call to Anthropic.

  Scenario: end to end: serves recall through the gateway, runs the worker, validates the Result and records the run
    Given an end-to-end stack whose scripted agent stores and searches memories
    When the end-to-end client calls the tool "remember" with:
      """
      {"content": "The staging database is rebuilt every Monday", "tags": ["ops"]}
      """
    Then the end-to-end call is not an error
    When the end-to-end client calls the tool "recall" with:
      """
      {"query": "staging database"}
      """
    Then the end-to-end call is not an error
    And the end-to-end Result has the status "ok"
    And the end-to-end recall summary is:
      """
      1 memory(ies) match "staging database"
      """
    And the first memory of the end-to-end recall contains "rebuilt every Monday"
    And the end-to-end Result costs 12 input tokens
    And the run recorded in the registry matches:
      """
      {"service": "memory", "tool": "recall", "status": "ok", "input": {"query": "staging database", "limit": 5}}
      """
    And the events recorded in the registry are "run.created, worker.started, worker.exited, output.validated, run.completed"
    And the events recorded in the registry are numbered "0, 1, 2, 3, 4"
    And the scripted agent received the system prompt of the tool "remember" containing "memory_insert"
    And the scripted agent received the system prompt of the tool "recall" containing "memory_search"
    And the gateway audit log holds these entries:
      | tool     | owner  | outcome |
      | remember | memory | ok      |
      | recall   | memory | ok      |

  Scenario: end to end: an invalid worker output becomes status failed with a named cause, recorded in the registry
    Given an end-to-end stack whose scripted agent returns an invalid output
    When the end-to-end client calls the tool "recall" with:
      """
      {"query": "anything"}
      """
    Then the end-to-end Result has the status "failed"
    And the end-to-end Result has no data
    And the end-to-end Result has the error code "WORKER_OUTPUT_INVALID" and a message
    And the run recorded in the registry has the status "failed"
    And the events recorded in the registry are "run.created, worker.started, worker.exited, output.invalid, run.completed"

  Scenario: end to end: an agent crash becomes status failed with cause WORKER_FAILED
    Given an end-to-end stack whose scripted agent crashes with "agent stopped: error_max_turns"
    When the end-to-end client calls the tool "recall" with:
      """
      {"query": "q"}
      """
    Then the end-to-end Result has the status "failed"
    And the end-to-end Result has the error code "WORKER_FAILED" and a message containing "error_max_turns"
