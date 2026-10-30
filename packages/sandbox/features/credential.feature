Feature: usage reading and command credential (host side)

  Scenario: usageOf reads a JSON response and ignores unparseable bodies
    When I read the usage of an "application/json" body '{"model":"m","content":[{"text":"x"}],"usage":{"input_tokens":1}}'
    Then the usage is '{"model":"m","input_tokens":1}'
    When I read the usage of an "application/json" body 'not json'
    Then the usage is '{}'
    When I read the usage of an "application/json" body '{"type":"error","error":{"type":"rate_limit_error","message":"m"}}'
    Then the usage is '{"error_type":"rate_limit_error"}'

  Scenario: commandCredential reads claudeAiOauth.accessToken and caches it while it is fresh
    Given a credential command that counts its runs and prints the access token "a" valid for one hour
    When I read the credential twice
    Then both readings give the access token "a"
    And the credential command ran 1 time

  Scenario: commandCredential refuses an expired credential and never echoes the command output
    Given a credential command that prints the access token "zz-secret" expired since the epoch plus 1 ms
    Then reading the credential is refused with "expired"
    Given a credential command that prints "zz-secret not json"
    Then reading the credential is refused with "^credential is not JSON$"
    Given a credential command that prints "zz-secret" and exits with code 3
    Then reading the credential is refused with "^credential command failed$"
