Feature: Test gate configuration and command line
  tools/test-gate/gate.json describes which files are production, features and step definitions, the components
  and the jobs: it is a descriptive file, loaded against its zod schema; a broken copy is rejected. The command
  line is `plan|check [--job <name>]`; anything else is refused with exit code 1.

  Scenario: the committed configuration and the fixture configuration load against the schema
    Then the committed gate configuration loads against its schema
    And the fixture gate configuration loads against its schema
    And the committed gate job "linux" counts "**/*.feature" with mutation "on"
    And the committed gate job "macos" counts "features/sandbox/**/*.feature" with mutation "off"

  Scenario: a job may count several feature globs
    Then a copy of the committed gate configuration with "jobs.macos.features" set to '["features/sandbox/**/*.feature", "features/macos/**/*.feature"]' loads

  Scenario Outline: a broken copy of the committed configuration is rejected: <path> = <value>
    Then a copy of the committed gate configuration with "<path>" set to '<value>' is rejected with:
      """
      <message>
      """

    Examples:
      | path                  | value       | message                                                                    |
      | production            | absent      | hors schéma : ✖ Invalid input: expected object, received undefined   → at production |
      | production.include    | []          | hors schéma : ✖ Too small: expected array to have >=1 items   → at production.include |
      | features.exclude      | absent      | hors schéma : ✖ Invalid input: expected array, received undefined   → at features.exclude |
      | stepDefinitions       | []          | hors schéma : ✖ Too small: expected array to have >=1 items   → at stepDefinitions |
      | components            | "packages"  | hors schéma : ✖ Invalid input: expected array, received string   → at components |
      | jobs.linux.mutation   | "yes"       | hors schéma : ✖ Invalid input: expected boolean, received string   → at jobs.linux.mutation |
      | jobs.linux.features   | [""]        | hors schéma : ✖ Too small: expected string to have >=1 characters   → at jobs.linux.features[0] |
      | jobs.linux.tags       | "@fast"     | hors schéma : ✖ Unrecognized key: "tags"   → at jobs.linux |
      | reports.plan          | ""          | hors schéma : ✖ Too small: expected string to have >=1 characters   → at reports.plan |
      | name                  | "smoke"     | hors schéma : ✖ Unrecognized key: "name" |

  Scenario: a configuration that is not JSON is refused by the command line
    Given a gate repository
    And the gate head is committed
    And the gate configuration reads:
      """
      { jobs
      """
    When the gate checks the "linux" job
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : tools/test-gate/gate.json : JSON invalide : Expected property name or '}' in JSON at position 2 (line 1 column 3)
      """

  Scenario: an absent configuration is refused
    Given a gate repository
    And the gate head is committed
    And the gate configuration is absent
    When the gate checks the "linux" job
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : tools/test-gate/gate.json absent
      """

  Scenario: a job the configuration does not declare is refused
    Given a gate repository
    And the gate head is committed
    When the gate plans the "windows" job
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : job inconnu : windows
      """

  Scenario Outline: arguments other than plan|check [--job <name>] are refused: "<arguments>"
    Given a gate repository
    And the gate head is committed
    When the gate runs with the arguments "<arguments>"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : usage : test-gate plan|check [--job <nom>]
      """

    Examples:
      | arguments                |
      |                          |
      | run                      |
      | check --jobs linux       |
      | check --job              |
      | plan --job linux extra   |
