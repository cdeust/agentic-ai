Feature: Auth proxy (host side, fake upstream, fake credential)
  The proxy holds the host credential, relays two routes and gives the sandbox only a session token.

  Background:
    Given a fake upstream answering with a server-sent-events stream that carries a usage
    And an auth proxy over that upstream with the session token "session-token-for-tests" and the host credential "host-credential"

  Scenario: relays POST /v1/messages with the host credential in place of the session token
    When I POST through the proxy "/v1/messages?beta=true" with the body '{"model":"m"}' and the headers:
      | anthropic-beta | x-1  |
      | x-api-key      | leak |
    Then the proxy response status is 200
    And the proxy response body is the upstream stream
    And the upstream received 1 request
    And the upstream request 0 has the url "/v1/messages?beta=true"
    And the upstream request 0 has the body '{"model":"m"}'
    And the upstream request 0 has the header "authorization" "Bearer host-credential"
    And the upstream request 0 has no header "x-api-key"
    And the upstream request 0 has the header "anthropic-beta" "x-1,oauth-2025-04-20"

  Scenario: logs one usage line per response: model, tokens, time, never content nor credential
    When I POST through the proxy "/v1/messages" with the body '{}'
    Then the usage log holds one record matching:
      """
      {"status":200,"route":"/v1/messages","model":"claude-test","input_tokens":12,"cache_read_input_tokens":3,"output_tokens":7}
      """
    And the usage record has a string "at"
    And the usage log does not contain "SECRET-CONTENT"
    And the usage log does not contain "host-credential"
    And the usage log does not contain "session-token-for-tests"

  Scenario: refuses without the session token (401), and forwards nothing
    When I POST through the proxy "/v1/messages" with the body '{}' and the session token "wrong"
    Then the proxy response status is 401
    When I POST through the proxy "/v1/messages" with the body '{}' and no authorization
    Then the proxy response status is 401
    And the upstream received no request

  Scenario Outline: refuses <method> <path> (403), and forwards nothing
    When I send "<method>" to "<path>" through the proxy
    Then the proxy response status is 403
    And the upstream received no request

    Examples:
      | method | path                                  |
      | GET    | /v1/messages                          |
      | POST   | /v1/models                            |
      | POST   | /api/oauth/profile                    |
      | POST   | /v1/messages/batches                  |
      | POST   | //evil.example/v1/messages            |
      | POST   | /v1/messages/../../api/oauth/token    |

  Scenario: refuses the session token once revoked (401)
    When the session token is revoked
    And I POST through the proxy "/v1/messages" with the body '{}'
    Then the proxy response status is 401
    And the upstream received no request

  Scenario: answers 503 without detail when the host credential cannot be read
    Given the proxy is restarted with a host credential that fails with "detail that must not leak"
    When I POST through the proxy "/v1/messages" with the body '{}'
    Then the proxy response status is 503
    And the proxy response body does not contain "detail that must not leak"
