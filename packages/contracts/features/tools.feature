Feature: Tool schemas
  The intent tools are declared once, with their input schemas, owner and description; the worker wire format is validated.

  Scenario: applies defaults and rejects empty input
    Then the recall input schema parses '{"query":"q"}' to '{"query":"q","limit":5}'
    And the remember input schema parses '{"content":"c"}' to '{"content":"c","tags":[]}'
    And the recall input schema rejects '{"query":""}'
    And the recall input schema rejects '{"query":"q","limit":500}'

  Scenario: declares an owner, a description and an output schema for every tool
    Then the tool names are "recall, remember"
    And every tool is owned by "memory"
    And every tool has a non-empty description

  Scenario: has no data operation that carries SQL
    Then no data operation name matches the pattern "sql|query" ignoring case

  Scenario: validates the worker wire format
    Then the worker output schema accepts:
      """
      { "status": "ok", "data": {}, "evidence": [], "cost": { "input_tokens": 0, "output_tokens": 0, "usd": 0 } }
      """
    And the worker output schema rejects:
      """
      { "status": "ok", "data": {}, "evidence": [], "cost": { "input_tokens": -1, "output_tokens": 0, "usd": 0 } }
      """
