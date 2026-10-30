Feature: Test gate outputs: the plan, the report, the step summary and the base of the next run
  `plan` writes reports/gate-plan.json, whose `mutate` list is what Stryker mutates. `check` writes
  reports/gate-report.md, appends it to $GITHUB_STEP_SUMMARY, prints it, and writes reports/gate-base.json only
  when green: the workflow uploads it on main for the runs of child commits.

  Background:
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate cucumber report is the fixture "green"

  Scenario: a changed production line plans that file only
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 3 changed
    And the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    When the gate plans with the default job
    Then the gate exits with 0
    And the gate output is:
      """
      plan linux : 1 fichier(s) à muter -> reports/gate-plan.json
      """
    And the gate plan is:
      """
      { "job": "linux", "head": "<head>", "firstParent": "<parent>", "mutate": ["src/math.mjs"] }
      """

  Scenario: an added .feature plans every production file, coveredBy narrows the perimeter afterwards
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature"
    And the gate repository holds the fixture specs "green.feature"
    And the gate first parent is committed
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate plan is:
      """
      { "job": "linux", "head": "<head>", "firstParent": "<parent>", "mutate": ["mod/a/src/a.mjs", "src/math.mjs"] }
      """

  Scenario: the macos job plans no mutation
    Given the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    When the gate plans the "macos" job
    Then the gate output is:
      """
      plan macos : 0 fichier(s) à muter -> reports/gate-plan.json
      """
    And the gate plan is:
      """
      { "job": "macos", "head": "<head>", "firstParent": "<parent>", "mutate": [] }
      """

  Scenario: a root commit plans every production file it holds
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate plan is:
      """
      { "job": "linux", "head": "<head>", "firstParent": null, "mutate": ["src/math.mjs"] }
      """

  Scenario: a green check writes the base of the next run, the step summary and prints the report
    Given the gate first parent is committed
    And the gate head is committed
    When the gate checks with the default job
    Then the gate verdict is green
    And the gate output is the gate report
    And the GitHub step summary holds the gate report 1 time
    And the gate base written is:
      """
      {
        "job": "linux",
        "sha": "<head>",
        "count": 5,
        "pickles": [
          "[\"specs/green.feature\",\"Green fixture\",\"a rule with a background\",\"a scenario of the rule\",null,null]",
          "[\"specs/green.feature\",\"Green fixture\",null,\"a plain scenario\",null,null]",
          "[\"specs/green.feature\",\"Green fixture\",null,\"an outline with <value>\",\"small values\",[\"1\"]]",
          "[\"specs/green.feature\",\"Green fixture\",null,\"an outline with <value>\",\"small values\",[\"2\"]]",
          "[\"specs/second.feature\",\"Second green fixture\",null,\"another passing scenario\",null,null]"
        ]
      }
      """

  Scenario: the step summary is appended to, never overwritten
    Given the gate first parent is committed
    And the gate head is committed
    When the gate checks the "linux" job
    And the gate checks the "linux" job
    Then the GitHub step summary holds the gate report 2 times

  Scenario: a red check removes the base a previous green check wrote
    Given the gate first parent is committed
    And the gate head is committed
    When the gate checks the "linux" job
    And the gate cucumber report is the fixture "filtered"
    And the gate checks the "linux" job
    Then the gate verdict is red
    And no gate base is written

  Scenario: the gate base written by a green check is the base the child commit reads
    Given the gate first parent is committed
    And the gate head is committed
    When the gate checks the "linux" job
    And the gate repository file "reports/base/gate-base.json" is the gate base just written
    And the gate repository holds the fixture specs "green.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green-only"
    And the gate checks the "linux" job
    Then the gate verdict is green
    And the gate report has the line "- base : 5, artefact gate-base.json du dernier run vert de main"

  Scenario: without GITHUB_STEP_SUMMARY, or with an empty one, no step summary is written
    Given the gate first parent is committed
    And the gate head is committed
    When the gate checks the "linux" job with the step summary "unset"
    And the gate checks the "linux" job with the step summary "empty"
    Then the gate verdict is green
    And no GitHub step summary is written

  Scenario: a root commit plans the tracked files present in the working tree only
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature"
    And the gate head is committed
    And the gate repository file "mod/a/src/a.mjs" is removed
    When the gate plans the "linux" job
    Then the gate plan is:
      """
      { "job": "linux", "head": "<head>", "firstParent": null, "mutate": ["src/math.mjs"] }
      """
