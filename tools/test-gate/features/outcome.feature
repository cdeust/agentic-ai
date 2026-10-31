Feature: Test gate, rule 2: one attempt, at least one step, every step PASSED
  The gate reads the Cucumber Messages report, never the exit code of cucumber nor TestRunFinished.success
  (doc §7.3): a SKIPPED step gives success true and exit code 0, the gate is red. Fixture reports are real
  cucumber-js 12.9.0 output of tools/test-gate/fixtures/suite (generate.cucumber.mjs).

  Background:
    Given a gate repository
    And the gate first parent is committed

  Scenario: a report where every pickle passed once is green and the report says so in full
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate output is the gate report
    And the gate report reads:
      """
      # Porte de test, job linux : VERTE

      - tête : <head>
      - premier parent : <parent>
      - exécutés : 5
      - statique : 5
      - base : repli, compte statique du premier parent <parent>, aucun run vert de main pour ce SHA (0)
      - attendu : base 0 + ajoutés 5 − supprimés 0 = 5
      - +5 −0

      ## Ajoutés (+5)

      - ["specs/green.feature","Green fixture","a rule with a background","a scenario of the rule",null,null]
      - ["specs/green.feature","Green fixture",null,"a plain scenario",null,null]
      - ["specs/green.feature","Green fixture",null,"an outline with <value>","small values",["1"]]
      - ["specs/green.feature","Green fixture",null,"an outline with <value>","small values",["2"]]
      - ["specs/second.feature","Second green fixture",null,"another passing scenario",null,null]

      ## Supprimés (−0)

      - aucun

      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 0
      - rencontrés dans le périmètre de ce run : 0
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0

      ## Violations

      ### Règle 1, identité des pickles

      - aucune

      ### Règle 2, une tentative, chaque step PASSED

      - aucune

      ### Règle 3, exécutés = statique

      - aucune

      ### Règle 4, exécutés = base + ajoutés − supprimés

      - aucune

      ### Règle 5, mutation

      - aucune

      ### Règle 6, dette de mutation

      - aucune

      ## Mutation

      - fichiers du périmètre : 0
      - mutants du périmètre : 0
      - mutants invalides (signalés, pas rouges) :
        - aucun
      """

  Scenario Outline: a step that is not PASSED makes the gate red, naming the pickle and the step: <case>
    Given the gate repository holds the fixture specs "<case>.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "<case>"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      2: ["specs/<case>.feature","<feature>",null,"<scenario>",null,null] : tentative 0, <step>
      """

    Examples:
      | case      | feature           | scenario           | step                                      |
      | undefined | Undefined fixture | an undefined step  | step « a step nobody defined » : UNDEFINED |
      | pending   | Pending fixture   | a pending step     | step « a pending step » : PENDING          |
      | ambiguous | Ambiguous fixture | an ambiguous step  | step « an ambiguous step » : AMBIGUOUS     |

  Scenario: a skipped step is red although cucumber exits 0 with success true, and so is every step after it
    Given the gate repository holds the fixture specs "skipped.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "skipped"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      2: ["specs/skipped.feature","Skipped fixture",null,"a skipped step",null,null] : tentative 0, step « a skipped step » : SKIPPED
      2: ["specs/skipped.feature","Skipped fixture",null,"a skipped step",null,null] : tentative 0, step « a passing step » : SKIPPED
      """

  Scenario: a failed step is red, and the steps skipped after it are listed too
    Given the gate repository holds the fixture specs "failed.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "failed"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      2: ["specs/failed.feature","Failed fixture",null,"a failed step",null,null] : tentative 0, step « a failing step » : FAILED
      2: ["specs/failed.feature","Failed fixture",null,"a failed step",null,null] : tentative 0, step « a passing step » : SKIPPED
      """

  Scenario: a failing hook counts as a step: the hook and the step it skipped are both red
    Given the gate repository holds the fixture specs "hook.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "hook"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      2: ["specs/hook.feature","Hook fixture",null,"a failing hook",null,null] : tentative 0, hook specs/steps/steps.mjs:34 : FAILED
      2: ["specs/hook.feature","Hook fixture",null,"a failing hook",null,null] : tentative 0, step « a passing step » : SKIPPED
      """

  Scenario: a pickle run twice is red even when its second attempt passed
    Given the gate repository holds the fixture specs "retried.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "retried"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      2: ["specs/retried.feature","Retried fixture",null,"a retried scenario",null,null] : 2 tentatives, une seule attendue
      2: ["specs/retried.feature","Retried fixture",null,"a retried scenario",null,null] : tentative 0 : willBeRetried
      2: ["specs/retried.feature","Retried fixture",null,"a retried scenario",null,null] : tentative 0, step « a step that passes on its second attempt » : FAILED
      2: ["specs/retried.feature","Retried fixture",null,"a retried scenario",null,null] : tentative 1 : attempt > 0
      """

  Scenario: a scenario without steps is red although nothing in it failed
    Given the gate repository holds the fixture specs "empty.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "empty"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      2: ["specs/empty.feature","Empty fixture",null,"a scenario without steps",null,null] : scénario sans step
      """

  Scenario: a run interrupted mid-way is red: unfinished step, unfinished attempt, unfinished run hook
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "interrupted"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      2: hook specs/steps/steps.mjs:38 : MISSING
      2: ["specs/second.feature","Second green fixture",null,"another passing scenario",null,null] : tentative 0 : non terminée
      2: ["specs/second.feature","Second green fixture",null,"another passing scenario",null,null] : tentative 0, step « a step with value 3 » : MISSING
      """

  Scenario: a failing BeforeAll stops cucumber before any test case: nothing executed, everything missing
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "run-hook-crash"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      3: ["specs/green.feature","Green fixture",null,"a plain scenario",null,null] : attendu, non exécuté
      3: ["specs/green.feature","Green fixture",null,"an outline with <value>","small values",["1"]] : attendu, non exécuté
      3: ["specs/green.feature","Green fixture",null,"an outline with <value>","small values",["2"]] : attendu, non exécuté
      3: ["specs/green.feature","Green fixture","a rule with a background","a scenario of the rule",null,null] : attendu, non exécuté
      3: ["specs/second.feature","Second green fixture",null,"another passing scenario",null,null] : attendu, non exécuté
      4: exécutés 0 ≠ base 0 + ajoutés 5 − supprimés 0 = 5
      """

  Scenario: an absent cucumber report is red
    Given the gate repository holds the fixture specs "second.feature"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      2: rapport Cucumber illisible : reports/cucumber.ndjson absent
      3: ["specs/second.feature","Second green fixture",null,"another passing scenario",null,null] : attendu, non exécuté
      4: exécutés 0 ≠ base 0 + ajoutés 1 − supprimés 0 = 1
      """

  Scenario: a report that is not NDJSON is red
    Given the gate head is committed
    And the gate cucumber report reads:
      """
      {"meta": not json
      """
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      2: rapport Cucumber illisible : rapport Cucumber invalide : Unexpected token 'o', "{"meta": not json" is not valid JSON
      """

  Scenario: a report whose test case points to no pickle is red
    Given the gate head is committed
    And the gate cucumber report reads:
      """
      {"testCase":{"testRunStartedId":"r","pickleId":"nowhere","id":"tc","testSteps":[]}}
      {"testCaseStarted":{"attempt":0,"testCaseId":"tc","id":"s","timestamp":{"seconds":0,"nanos":0}}}
      """
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      2: rapport Cucumber illisible : rapport Cucumber invalide : Cannot read properties of undefined (reading 'id')
      """
