Feature: Gateway port adapters
  Every adapter of a gateway port satisfies the contract of its port. Adding an adapter means adding one Examples row.

  Scenario Outline: Authenticator contract: resolves a valid token to its identity
    Given the "<adapter>" authenticator accepting token "t-1" for subject "alice"
    Then authenticating with token "t-1" resolves to the identity '{"subject":"alice"}'

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: Authenticator contract: rejects a missing or unknown token with UNAUTHORIZED
    Given the "<adapter>" authenticator accepting token "t-1" for subject "alice"
    Then authenticating without a token is refused with code "UNAUTHORIZED"
    And authenticating with token "nope" is refused with code "UNAUTHORIZED"

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: QuotaPolicy contract: allows up to the limit then throws QUOTA_EXCEEDED
    Given the "<adapter>" quota policy with a limit of 2 calls
    When subject "a" consumes "recall" 2 times
    Then subject "a" consuming "recall" is refused with code "QUOTA_EXCEEDED"

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: QuotaPolicy contract: counts per identity and per tool
    Given the "<adapter>" quota policy with a limit of 2 calls
    When subject "a" consumes "recall" 2 times
    Then subject "b" can consume "recall"
    And subject "a" can consume "remember"

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: AuditLog contract: records entries in order without loss
    Given the "<adapter>" audit log
    When the audit log records the entry '{"tool":"recall","outcome":"ok"}'
    And the audit log records the entry '{"tool":"remember","outcome":"error","error_code":"QUOTA_EXCEEDED"}'
    Then the audit log reads back '[{"tool":"recall"},{"tool":"remember","error_code":"QUOTA_EXCEEDED"}]'

    Examples:
      | adapter    |
      | in-memory  |
      | json lines |

  Scenario Outline: ServiceClient contract: routes to the owner and returns its answer untouched
    Given the "<adapter>" service client where "memory/recall" answers '{"ok":true}'
    When the service client invokes "memory" tool "recall" with arguments '{"query":"q"}'
    Then the service client response matches '{"isError":false,"structured":{"ok":true}}'

    Examples:
      | adapter   |
      | in-memory |
      | mcp       |

  Scenario Outline: ServiceClient contract: throws SERVICE_UNAVAILABLE for a service it cannot reach
    Given the "<adapter>" service client where "memory/recall" answers '{"ok":true}'
    When the service client invokes "ghost" tool "recall" with arguments '{}'
    Then the service client invocation is refused with code "SERVICE_UNAVAILABLE"

    Examples:
      | adapter   |
      | in-memory |
      | mcp       |

  Scenario: InMemoryQuota window resets after the window elapses
    Given an in-memory quota policy with a limit of 1 call per 1000 ms on a manual clock
    When subject "a" consumes "t" 1 times
    And the quota clock moves to 1001 ms
    Then subject "a" can consume "t"

  Scenario: McpServiceClient failures wraps transport errors and keeps the service error flag
    Given an MCP service client whose "memory" client fails with 'down'
    When the service client invokes "memory" tool "recall" with arguments '{}'
    Then the service client invocation is rejected with a message containing "down"
    Given an MCP service client whose "memory" client answers an error with the text 'boom'
    When the service client invokes "memory" tool "recall" with arguments '{}'
    Then the service client response matches '{"isError":true,"text":"boom"}'
