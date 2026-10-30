Feature: Green fixture
  Every pickle passes once: a plain Scenario, a Scenario Outline with named Examples, a Rule.

  Scenario: a plain scenario
    Given a passing step

  Scenario Outline: an outline with <value>
    Given a step with value <value>

    Examples: small values
      | value |
      | 1     |
      | 2     |

  Rule: a rule with a background

    Background:
      Given a passing step

    Scenario: a scenario of the rule
      Given a passing step
