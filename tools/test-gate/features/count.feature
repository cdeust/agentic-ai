Feature: Test gate, rule 4: executed = base + added - removed
  base is the count published by the last green run of main for the first parent (reports/base/gate-base.json,
  downloaded by the workflow). Without it the written fallback applies: the static count of the first parent, and
  the report says so. added and removed are set differences between the static sets of the first parent and of
  the working tree, never declared.

  Background:
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate first parent is committed

  Scenario: without a base the fallback is the static count of the first parent, flagged in the report
    Given the gate repository holds the fixture specs "green.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green-only"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate report has the line "- base : repli, compte statique du premier parent <parent>, aucun run vert de main pour ce SHA (5)"
    And the gate report has the line "- attendu : base 5 + ajoutés 0 − supprimés 1 = 4"
    And the gate report has the line "- +0 −1"
    And the gate report has the line "## Supprimés (−1)"
    And the gate report has the line:
      """
      - ["specs/second.feature","Second green fixture",null,"another passing scenario",null,null]
      """
    And the gate report has the line "## Ajoutés (+0)"

  Scenario: a base of the first parent and of this job is the base of the count
    Given the gate repository holds the fixture specs "green.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green-only"
    And the gate base is the fixture "linux"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate report has the line "- base : 5, artefact gate-base.json du dernier run vert de main"
    And the gate report has the line "- attendu : base 5 + ajoutés 0 − supprimés 1 = 4"

  Scenario: a count that does not match the base is red
    Given the gate head is committed
    And the gate cucumber report is the fixture "green"
    And the gate base is the fixture "count-7"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      4: exécutés 5 ≠ base 7 + ajoutés 0 − supprimés 0 = 7
      """

  Scenario: a base of another SHA is red
    Given the gate head is committed
    And the gate cucumber report is the fixture "green"
    And the gate base is the fixture "other-sha"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      4: base d'un autre SHA : f00df00df00df00df00df00df00df00df00df00d, premier parent <parent>
      """

  Scenario: a base of another job is red
    Given the gate head is committed
    And the gate cucumber report is the fixture "green"
    And the gate base is the fixture "macos"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      4: base d'un autre job : macos, job linux
      """

  Scenario: a base that is not a gate base is red and the fallback is used for the count
    Given the gate head is committed
    And the gate cucumber report is the fixture "green"
    And the gate base reads:
      """
      { "job": "linux", "count": -1, "pickles": [] }
      """
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      4: base illisible : hors schéma : ✖ Invalid input: expected string, received undefined   → at sha ✖ Too small: expected number to be >=0   → at count
      """
    And the gate report has the line "- attendu : base 5 + ajoutés 0 − supprimés 0 = 5"

  Scenario: a base that is not JSON is red
    Given the gate head is committed
    And the gate cucumber report is the fixture "green"
    And the gate base reads:
      """
      count: 5
      """
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      4: base illisible : JSON invalide : Unexpected token 'c', "count: 5" is not valid JSON
      """

  Scenario: a root commit has base 0 and everything added; a base cannot belong to its missing first parent
    Given a gate repository
    And the gate repository holds the fixture specs "second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    And the gate base is the fixture "other-sha"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate report has the line "- premier parent : aucun"
    And the gate report has the line "- base : 5, artefact gate-base.json du dernier run vert de main"
    And the gate violations of rule 4 are:
      """
      4: base d'un autre SHA : f00df00df00df00df00df00df00df00df00df00d, premier parent aucun
      4: exécutés 5 ≠ base 5 + ajoutés 1 − supprimés 0 = 6
      """

  Scenario: a root commit without base counts from 0
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate report has the line "- base : 0, aucun premier parent, tout est ajouté"
    And the gate report has the line "- attendu : base 0 + ajoutés 5 − supprimés 0 = 5"
