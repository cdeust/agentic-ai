Feature: SandboxRunner contract on the in-memory adapter
  The same three cases run against the real srt adapter in features/sandbox/srt-runner.feature.

  Scenario Outline: SandboxRunner contract: refuses an unknown profile
    Given a "<adapter>" sandbox runner
    When I try to start profile "nope" with command "cat"
    Then it is refused with "PROFILE_INVALID"

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: SandboxRunner contract: runs the command with pipes: stdin in, stdout out, exit 0
    Given a "<adapter>" sandbox runner
    When I start profile "builder" with command "cat"
    And I send the line "ping" on its standard input and close it
    Then its standard output is the line "ping"
    And it exits with code 0

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: SandboxRunner contract: stop() ends a running sandbox
    Given a "<adapter>" sandbox runner
    When I start profile "builder" with command "cat"
    And I stop it
    Then the exit code of the stop is not 0
    And its exit is the same as the exit of the stop

    Examples:
      | adapter   |
      | in-memory |

  Scenario: srt adapter refuses when srt is missing, with no fallback
    Given an srt runner over a throwaway git repository whose srt cli is missing
    When I try to start profile "builder" with command "cat"
    Then it is refused with "ISOLATION_UNAVAILABLE"

  Scenario: srt adapter refuses a srt that does not isolate: the canary reads the secret and reaches the port
    Given an srt runner over a throwaway git repository whose srt does not isolate
    When I try to start profile "builder" with command "cat"
    Then it is refused with "ISOLATION_UNAVAILABLE: canari : lecture allowed, connexion allowed"

  Scenario: srt adapter refuses the main checkout as working directory
    Given an srt runner over a throwaway git repository
    And the working directory is the main checkout of the repository
    When I try to start profile "builder" with command "cat"
    Then it is refused with "NOT_A_WORKTREE"

  Scenario: srt adapter runInTerminal refuses when the descriptors are not terminals
    Given an srt runner over a throwaway git repository whose descriptors are not terminals
    When I try to run profile "builder" with command "cat" in the terminal
    Then it is refused with "TERMINAL_REQUIRED"

  Scenario: srt adapter runInTerminal uses the default descriptor check when isTerminal is absent and refuses
    Given an srt runner over a throwaway git repository whose isatty says only descriptor 2 is not a terminal
    When I try to run profile "builder" with command "cat" in the terminal
    Then it is refused with "TERMINAL_REQUIRED"

  Scenario: srt adapter runInTerminal goes past the default descriptor check when all three are terminals
    Given an srt runner over a throwaway git repository whose isatty says every descriptor is a terminal and whose srt cli is missing
    When I try to run profile "builder" with command "cat" in the terminal
    Then it is refused with "ISOLATION_UNAVAILABLE"

  Scenario: standard streams are terminals when isatty says so for descriptors 0, 1 and 2 and only those
    When I check the standard streams with an isatty that accepts every descriptor
    Then the standard streams are terminals
    And isatty was asked about the descriptors "0,1,2"

  Scenario Outline: standard streams are not terminals when descriptor <fd> is not
    When I check the standard streams with an isatty that refuses descriptor <fd>
    Then the standard streams are not terminals

    Examples:
      | fd |
      | 0  |
      | 1  |
      | 2  |
