Feature: CallTool
  The gateway use case: authenticate, apply the quota, route to the owner of the tool, journal the call.

  Scenario: routes every contract tool to its owner (the catalogue is packages/contracts TOOLS)
    Given a CallTool with a recording quota and a recording service client
    When the tool "remember" is called with arguments '{"content":"c"}' and token "t"
    Then the recorded calls are "quota, invoke:memory/remember"

  Scenario: authenticates, applies the quota, routes to the owner and journals the call
    Given a CallTool with a recording quota and a recording service client
    When the tool "recall" is called with arguments '{"query":"q"}' and token "t"
    Then the call returns the service answer
    And the recorded calls are "quota, invoke:memory/recall"
    And the audit entries match '[{"subject":"alice","tool":"recall","owner":"memory","outcome":"ok"}]'

  Scenario: refuses an unknown tool before touching auth or services
    Given a CallTool with a recording quota and a recording service client
    When the tool "nope" is called with arguments '{}' and token "t"
    Then the call is refused with code "UNKNOWN_TOOL"
    And no call was recorded
    And the audit entries match '[{"tool":"nope","owner":null,"outcome":"error","error_code":"UNKNOWN_TOOL"}]'

  Scenario: refuses an unauthenticated call without consuming quota or routing, and journals it
    Given a CallTool with a recording quota and a recording service client
    When the tool "recall" is called with arguments '{}' and no token
    Then the call is refused with code "UNAUTHORIZED"
    And no call was recorded
    And the audit entries match '[{"subject":"anonymous","outcome":"error","error_code":"UNAUTHORIZED"}]'

  Scenario: does not route when the quota is exhausted
    Given a CallTool whose quota is exhausted and a recording service client
    When the tool "recall" is called with arguments '{}' and token "t"
    Then the call is refused with code "QUOTA_EXCEEDED"
    And no call was recorded
    And the first audit entry matches '{"subject":"alice","error_code":"QUOTA_EXCEEDED"}'

  Scenario: journals a service outage
    Given a CallTool with a recording quota and a service client that is unavailable
    When the tool "recall" is called with arguments '{}' and token "t"
    Then the call is refused with code "SERVICE_UNAVAILABLE"
    And the first audit entry matches '{"outcome":"error","error_code":"SERVICE_UNAVAILABLE"}'
