Feature: Gateway MCP server
  A client reaches the tool catalogue over MCP framing; the gateway authenticates, applies the quota and routes.

  Scenario: lists the catalogue
    Given a connected gateway client with token "good"
    When the gateway client lists the tools
    Then the gateway tool names are "recall, remember"

  Scenario: forwards a call to the owner and returns its structured Result
    Given a connected gateway client with token "good"
    When the gateway client calls "remember" with arguments '{"content":"x"}'
    Then the gateway structured content matches '{"status":"ok","run_id":"r1"}'
    And the gateway audit entries match '[{"outcome":"ok","tool":"remember"}]'

  Scenario Outline: answers <case> with a named error
    Given a connected gateway client <presenting>
    When the gateway client calls "remember" with arguments '{"content":"x"}'
    Then the gateway answer is an error containing "UNAUTHORIZED"

    Examples:
      | case        | presenting         |
      | no token    | without a token    |
      | a bad token | with token "bad"   |

  Scenario: answers QUOTA_EXCEEDED once the quota is used
    Given a connected gateway client with token "good" and a quota of 1 call
    When the gateway client calls "remember" with arguments '{"content":"x"}'
    And the gateway client calls "remember" with arguments '{"content":"x"}'
    Then the gateway answer is an error containing "QUOTA_EXCEEDED"

  Scenario: answers SERVICE_UNAVAILABLE when no handler owns the tool
    Given a connected gateway client with token "good"
    When the gateway client calls "recall" with arguments '{"query":"q"}'
    Then the gateway answer contains "SERVICE_UNAVAILABLE"

  Scenario: derives one route per owning service, with the URL variable compose.yaml sets
    When the gateway routes are derived
    Then the gateway routes are '[{"service":"memory","urlVariable":"MEMORY_URL"}]'
