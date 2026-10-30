Feature: Memory MCP server
  The memory service registers the intent tools it owns and answers with a structured Result.

  Scenario: exposes the intent tools it owns
    Given a memory MCP client over a worker that prints '{}'
    When the memory MCP client lists the tools
    Then the memory tool names are "recall, remember"

  Scenario: answers a remember call with a structured Result
    Given a memory MCP client over a worker that prints '{"status":"ok","data":{"memory_id":"m1"},"evidence":[],"cost":{"input_tokens":1,"output_tokens":1,"usd":0}}'
    When the memory MCP client calls "remember" with arguments '{"content":"x"}'
    Then the memory structured content matches '{"status":"ok","data":{"memory_id":"m1"}}'
