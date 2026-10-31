Feature: GitHub workflows
  Every workflow pins its actions by commit SHA, installs without lifecycle scripts and checks out without
  credentials; gate.yml (docs/design/platform-v3-srt.md §7) has the narrow trigger, permission and secret rules of
  the CI gate. The Examples list the committed workflows: a new file in .github/workflows adds its row.

  Scenario Outline: workflow <file> pins its actions, installs without scripts and checks out without credentials
    Given the committed workflow "<file>"
    Then every action it uses is pinned by a commit SHA
    And every npm ci in it has --ignore-scripts
    And every checkout in it has persist-credentials false

    Examples:
      | file                   |
      | bench-sandbox.yml      |
      | claude-code-review.yml |
      | claude.yml             |
      | gate.yml               |

  Scenario: gate.yml follows the rules of the CI gate
    Given the committed workflow "gate.yml"
    Then it satisfies the gate workflow rules

  Scenario: a workflow with an unpinned action is rejected
    Given the committed workflow "gate.yml"
    Then a workflow with an unpinned action is rejected

  Scenario: a workflow with an npm ci without --ignore-scripts is rejected
    Given the committed workflow "gate.yml"
    Then a workflow with an npm ci without --ignore-scripts is rejected

  Scenario: a workflow with a checkout that keeps its credentials is rejected
    Given the committed workflow "gate.yml"
    Then a workflow with a checkout that keeps its credentials is rejected

  Scenario: a gate workflow triggered by pull_request_target is rejected
    Given the committed workflow "gate.yml"
    Then a gate workflow triggered by pull_request_target is rejected

  Scenario: a gate workflow that uses a secret is rejected
    Given the committed workflow "gate.yml"
    Then a gate workflow that uses a secret is rejected

  Scenario: a gate workflow with a cache is rejected
    Given the committed workflow "gate.yml"
    Then a gate workflow with a cache is rejected

  Scenario: a gate workflow with broader permissions is rejected
    Given the committed workflow "gate.yml"
    Then a gate workflow with broader permissions is rejected
