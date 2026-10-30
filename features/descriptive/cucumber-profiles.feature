Feature: Cucumber profiles
  cucumber.mjs has the default profile, which `npm test` and the gate count, and the `mutation` profile, which only
  Stryker uses (docs/design/platform-v3-srt.md §7). The mutation run leaves out features/repository (typecheck and
  format run tsc and prettier in child processes and kill no mutant); nothing else may differ.

  Scenario: the default profile is a plain scope that covers every feature of the gate
    Given the committed cucumber configuration
    Then its default profile has no tags, no name, retry 0 and strict
    And its default profile covers every feature file of the gate

  Scenario: the mutation profile differs from the default only by excluding features/repository
    Given the committed cucumber configuration
    Then its mutation profile differs from the default profile only by its paths
    And its mutation profile covers every feature file of the default profile except those of features/repository

  Scenario: Stryker uses the mutation profile
    Given the committed Stryker configuration
    Then its cucumber runner profile is "mutation"

  Scenario: a default profile with tags is rejected
    Given the committed cucumber configuration
    Then a default profile with tags is rejected

  Scenario: a default profile with a name filter is rejected
    Given the committed cucumber configuration
    Then a default profile with a name filter is rejected

  Scenario: a mutation profile that also drops features/integration is rejected
    Given the committed cucumber configuration
    Then a mutation profile that also drops features/integration is rejected
