Feature: Test gate, rule 6: the mutation debt registry only shrinks
  gate.json `debt` names the registry of the surviving mutants of the code that predates brick 1a. A Survived or
  NoCoverage mutant of the rule 5 perimeter whose identity (`file:l:c-l:c mutator "original" -> "replacement"`) is in
  the registry is accepted; rule 6 asks the registry to be readable, to be created once and then only shrink, a
  removal to be proved by the mutation report, and every entry to still match a surviving mutant. The mutation
  fixtures derive from a real Stryker 10.1.1 report of tools/test-gate/fixtures/suite/src/math.mjs, the registries
  from them (fixtures/README.md). Every disposable repository starts with the empty registry at the `debt` path.

  Background:
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate cucumber report is the fixture "green"

  Scenario: a surviving mutant of the perimeter that the registry holds is accepted
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """
    And the gate mutation section reads:
      """
      ## Mutation

      - fichiers du périmètre : 1
      - mutants du périmètre : 5
        - Killed : 4
        - Survived : 1
      - mutants invalides (signalés, pas rouges) :
        - aucun
      """

  Scenario: a surviving mutant of the perimeter that the empty registry does not hold stays red by rule 5
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: src/math.mjs:7 EqualityOperator #5 : Survived
      """
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 0
      - rencontrés dans le périmètre de ce run : 0
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

  Scenario Outline: a registered mutant is accepted when NoCoverage and never when Pending: <status>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "<status>"
    When the gate checks the "linux" job
    Then the gate verdict is "<verdict>"
    And the gate violations are:
      """
      <rule 5>
      <rule 6>
      """

    Examples:
      | status     | verdict | rule 5                                            | rule 6                                                                                                                                      |
      | NoCoverage | green   |                                                   |                                                                                                                                             |
      | Pending    | red     | 5: src/math.mjs:7 EqualityOperator #5 : Pending   | 6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : introuvable (code supprimé, déplacé ou dette payée), à retirer dans la même PR |

  Scenario Outline: an entry that differs from the surviving mutant by one field does not accept it: <field>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "survivor" with "<field>" of its entry 1 set to "<value>"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: src/math.mjs:7 EqualityOperator #5 : Survived
      6: <identity> : introuvable (code supprimé, déplacé ou dette payée), à retirer dans la même PR
      """

    Examples:
      | field        | value                | identity                                                           |
      | end.column   | 16                   | src/math.mjs:7:10-7:16 EqualityOperator "n > 0" -> "n >= 0"       |
      | start.column | 9                    | src/math.mjs:7:9-7:15 EqualityOperator "n > 0" -> "n >= 0"        |
      | start.line   | 6                    | src/math.mjs:6:10-7:15 EqualityOperator "n > 0" -> "n >= 0"        |
      | end.line     | 8                    | src/math.mjs:7:10-8:15 EqualityOperator "n > 0" -> "n >= 0"        |
      | replacement  | n >= 1               | src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 1"       |
      | mutator      | RelationalOperator   | src/math.mjs:7:10-7:15 RelationalOperator "n > 0" -> "n >= 0"      |
      | original     | n > 1                | src/math.mjs:7:10-7:15 EqualityOperator "n > 1" -> "n >= 0"       |

  Scenario Outline: the original of a multi-line mutant is the text between its start and its end, lines included: <mutant>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line <line> changed
    And the gate debt registry is the fixture "<registry>"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "<mutant>" of the gate mutation report has the status "Survived"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

    Examples:
      | mutant | line | registry |
      | 0      | 3    | block-0  |
      | 2      | 6    | block-2  |

  Scenario: a multi-line mutant that ends before the end of its last line has only the text up to its end as original
    Given the gate repository holds "src/math.mjs" of the mutation fixture "partial-line" with line 3 changed
    And the gate debt registry is the fixture "partial-line"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "partial-line"
    And the gate head is committed
    And the gate mutation report is the fixture "partial-line"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

  Scenario: a single-line mutant on the first line of its file is identified from the first line of the source
    Given the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature" with line 1 changed
    And the gate debt registry is the fixture "a-survivor"
    And the gate first parent is committed
    And the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature"
    And the gate head is committed
    And the gate mutation report is the fixture "covered-by-feature"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

  Scenario: an entry added to the registry is red by rule 6 alone, although the mutant it names really survives
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : entrée ajoutée au registre, le registre ne peut que rétrécir
      """
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées ajoutées par ce diff : 1
      - entrées retirées par ce diff : 0
      """

  Scenario: the diff that creates the registry is green and says so
    Given the gate debt registry is absent
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées ajoutées par ce diff : 1
      - entrées retirées par ce diff : 0
      - création du registre par ce diff (le premier parent n'en a pas)
      """

  Scenario: a repository of one commit creates the registry too
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées ajoutées par ce diff : 1
      - entrées retirées par ce diff : 0
      - création du registre par ce diff (le premier parent n'en a pas)
      """

  Scenario: the registry is absent from the working tree and held by the first parent: unreadable
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is absent
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: registre de dette illisible : mutation-debt.json absent
      """

  Scenario: the registry is absent from the working tree and from the first parent: unreadable
    Given the gate debt registry is absent
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate first parent is committed
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: registre de dette illisible : mutation-debt.json absent
      """

  Scenario: a registry that is not JSON is unreadable
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry reads:
      """
      {"survivors": [
      """
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations of rule 6 start with "registre de dette illisible : JSON invalide : "

  Scenario Outline: a registry that does not match its schema is unreadable: <registry>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "<registry>"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: registre de dette illisible : hors schéma : <failure>
      """

    Examples:
      | registry        | failure                                                                           |
      | unknown-key     | ✖ Unrecognized key: "extra"                                                       |
      | negative-column | ✖ Too small: expected number to be >=0   → at survivors[0].start.column          |

  Scenario: a registry of the first parent that does not match its schema is red, the current one being fine
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "unknown-key"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: registre de dette illisible au premier parent : hors schéma : ✖ Unrecognized key: "extra"
      """

  Scenario: a registry of the first parent that is not JSON is red, the current one being fine
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry reads:
      """
      not json
      """
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations of rule 6 start with "registre de dette illisible au premier parent : JSON invalide : "

  Scenario: an entry removed because the debt is paid is green once the report shows its mutant killed
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "Killed"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 0
      - rencontrés dans le périmètre de ce run : 0
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 1
      """

  Scenario: the plan of a diff that only removes an entry holds the file of that entry
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate plan is:
      """
      { "job": "linux", "head": "<head>", "firstParent": "<parent>", "mutate": ["src/math.mjs"] }
      """

  Scenario: the plan holds the file of the removed entry only, not the other file that the registry still holds
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature"
    And the gate debt registry is the fixture "a-and-survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "a-survivor"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate plan is:
      """
      { "job": "linux", "head": "<head>", "firstParent": "<parent>", "mutate": ["src/math.mjs"] }
      """

  Scenario: the plan does not hold the file of a removed entry that the diff deleted
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository file "src/math.mjs" is removed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate plan is:
      """
      { "job": "linux", "head": "<head>", "firstParent": "<parent>", "mutate": [] }
      """

  Scenario: the plan of the macos job holds no file, whatever the registry removed
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    When the gate plans the "macos" job
    Then the gate plan is:
      """
      { "job": "macos", "head": "<head>", "firstParent": "<parent>", "mutate": [] }
      """

  Scenario Outline: a removed entry whose mutant still is not killed is refused: <status>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "<status>"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : retrait refusé, le survivant existe toujours
      """

    Examples:
      | status     |
      | Survived   |
      | NoCoverage |
      | Pending    |

  Scenario: a removed entry whose file the mutation report does not speak of is not proved
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "missing-file"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : retrait non prouvé, le fichier n'est pas dans le rapport de mutation
      """

  Scenario: a removed entry whose file Stryker mutated without finding a mutant is proved
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "no-mutant"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation

  Scenario: an entry removed with its deleted file needs no proof
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository file "src/math.mjs" is removed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "missing-file"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 0
      - rencontrés dans le périmètre de ce run : 0
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 1
      """

  Scenario: an entry kept in the registry while its file is deleted is red
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository file "src/math.mjs" is removed
    And the gate head is committed
    And the gate mutation report is the fixture "missing-file"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : fichier absent, entrée à retirer dans la même PR
      """

  Scenario: an entry whose code moved by one line is not found, and the registry says to remove it
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate mutation report is the fixture "survivor"
    And the code of "src/math.mjs" moves down by one line from line 7 in the gate mutation report and in the working tree
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : introuvable (code supprimé, déplacé ou dette payée), à retirer dans la même PR
      """

  Scenario: an entry whose mutant is now killed is not found: the debt is paid but the entry stays
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "Killed"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : introuvable (code supprimé, déplacé ou dette payée), à retirer dans la même PR
      """

  Scenario: an entry whose file is not in the mutation report is not judged
    Given the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature"
    And the gate debt registry is the fixture "a-survivor"
    And the gate first parent is committed
    And the gate head is committed
    And the gate mutation report is the fixture "nocoverage"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 0
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

  Scenario: an entry whose file Stryker mutated without finding a mutant is not found
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate head is committed
    And the gate mutation report is the fixture "no-mutant"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : introuvable (code supprimé, déplacé ou dette payée), à retirer dans la même PR
      """

  Scenario: two entries with the same identity are red
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "duplicate"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : identité en double dans le registre
      """
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 2
      - rencontrés dans le périmètre de ce run : 1
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

  Scenario: an unreadable mutation report with a removal reports the report once, and no removal violation
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: rapport de mutation illisible : reports/mutation/mutation.json absent
      """

  Scenario: an unreadable mutation report is red when the diff only removes an entry: the removal cannot be proved
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: rapport de mutation illisible : reports/mutation/mutation.json absent
      """

  Scenario: an unreadable mutation report judges no entry of the registry: the report is the only violation
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: rapport de mutation illisible : reports/mutation/mutation.json absent
      """

  Scenario: the macos job does not read the registry
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "macos" job
    Then the gate verdict is green
    And the gate report has no debt section

  Scenario: the macos job ignores an absent registry
    Given the gate debt registry is absent
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "macos" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate report has no debt section

  Scenario: the macos job ignores a registry that is not JSON, in the working tree and at the first parent
    Given the gate debt registry reads:
      """
      not json
      """
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate first parent is committed
    And the gate debt registry reads:
      """
      {"survivors": [
      """
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "macos" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate report has no debt section

  Scenario Outline: the macos job ignores a registry that does not match its schema: <registry>
    Given the gate debt registry is the fixture "<registry>"
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "macos" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate report has no debt section

    Examples:
      | registry        |
      | unknown-key     |
      | negative-column |

  Scenario: debt writes the registry sorted by file, line, column, mutator and replacement, Survived and NoCoverage only
    Given the gate debt registry is absent
    And the gate mutation report is the fixture "unsorted"
    When the gate runs with the arguments "debt"
    Then the gate exits with 0
    And the gate output is:
      """
      registre de dette écrit : mutation-debt.json
      - mod : 1
      - src : 6
      - total : 7
      """
    And the gate repository file "mutation-debt.json" is the fixture "debt/unsorted.json"

  Scenario: debt does not regenerate an existing registry
    Given the gate debt registry is the fixture "survivor"
    And the gate mutation report is the fixture "unsorted"
    When the gate runs with the arguments "debt"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : le registre ne peut que rétrécir : on ne le régénère pas (mutation-debt.json existe déjà)
      """
    And the gate repository file "mutation-debt.json" is the fixture "debt/survivor.json"

  Scenario: debt refuses an absent mutation report and writes nothing
    Given the gate debt registry is absent
    When the gate runs with the arguments "debt"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : rapport de mutation illisible : reports/mutation/mutation.json absent
      """
    And the gate repository holds no file "mutation-debt.json"

  Scenario: debt refuses an unreadable mutation report and writes nothing
    Given the gate debt registry is absent
    And the gate mutation report reads:
      """
      []
      """
    When the gate runs with the arguments "debt"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : rapport de mutation illisible : hors schéma : ✖ Invalid input: expected object, received array
      """
    And the gate repository holds no file "mutation-debt.json"

  Scenario Outline: debt takes no argument: <arguments>
    Given the gate debt registry is absent
    And the gate mutation report is the fixture "unsorted"
    When the gate runs with the arguments "<arguments>"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : usage : test-gate plan|check [--job <nom>] | debt
      """
    And the gate repository holds no file "mutation-debt.json"

    Examples:
      | arguments       |
      | debt now        |
      | debt --job macos |

  Scenario: the registry that debt writes from a mutation report is accepted as it is by check on that same report
    Given the gate debt registry is absent
    And the gate repository holds "src/math.mjs" of the mutation fixture "unsorted"
    And the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "unsorted"
    And the gate mutation report is the fixture "unsorted"
    And the gate runs with the arguments "debt"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 7
      - rencontrés dans le périmètre de ce run : 7
      - entrées ajoutées par ce diff : 7
      - entrées retirées par ce diff : 0
      - création du registre par ce diff (le premier parent n'en a pas)
      """
