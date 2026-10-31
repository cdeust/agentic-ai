# Fixtures of tools/test-gate

Nothing here sits under a `features/` directory: these files are inputs of the gate's own scenarios, never pickles
of the repository.

| Path        | What                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `gate.json` | Configuration of the temporary repositories the scenarios create (`specs/`, `src/`, `mod/<name>/`). |
| `suite/`    | A small cucumber suite: `specs/*.feature`, plain JS steps, `src/math.mjs`.                          |
| `reports/`  | Cucumber Messages NDJSON reports of `suite/`, real cucumber-js 12.9.0 output.                       |
| `mutation/` | Stryker JSON reports of `suite/src/math.mjs`, derived from a real Stryker 10.1.1 report.            |
| `base/`     | `gate-base.json` files; `FIRST_PARENT` is replaced by the SHA of the temporary first parent.        |

## Mutation debt registry

`gate.json` carries `"debt": "mutation-debt.json"`, and every disposable repository starts with the empty registry
`{"survivors": []}` at that path, so the scenarios that do not speak of the debt see no difference (their first
parent holds the registry, or none: then the report says the diff creates it). Rule 6 (doc §7) reads that file,
the one at the first parent, and the mutation report. An entry is `file`, `start` and `end` (`line` from 1, `column`
from 1 as in the Stryker report, end exclusive), `mutator`, `original` (the source slice between start and end) and
`replacement`; its identity is the text `file:l:c-l:c mutator "original" -> "replacement"`, never the mutant `id`.
Creation is allowed when the first parent has no registry; afterwards it only shrinks. Known limit: a shift of
lines in a file with debt makes its entry not found and the moved mutant unregistered, so the debt is paid or the
entry removed in the same PR. `test-gate debt` writes the registry from the mutation report, once.

## Reports

`cd tools/test-gate/fixtures/suite && npx cucumber-js --config generate.cucumber.mjs --profile <name>` writes
`reports/<name>.ndjson` (profiles in `generate.cucumber.mjs`), then replace the absolute path of `suite/` by
`<suite>` (stack traces). `interrupted.ndjson` is `green.ndjson` minus four envelopes (see the comment of
`generate.cucumber.mjs`). `run-hook-crash.ndjson` is real: a failing `BeforeAll` stops cucumber-js 12.9.0 before
any test case and before the message formatter writes more than the sources and pickles.

## Mutation reports

`cd tools/test-gate/fixtures/suite && npx stryker run generate.stryker.mjs` writes `mutation/real.json` (not
committed). It shows that the cucumber runner fills `coveredBy` with perTest coverage: test ids are remapped to
indexes and `testFiles` maps them to their `.feature`. The committed reports keep its shape (`statusReason`,
`duration`, `projectRoot`, `framework` and the test sources dropped; `config` reduced to `mutate`) with these edits:

| File                       | Edit                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `survivor.json`            | #1 and #3 Killed: one survivor, #5 `n >= 0` on line 7.                                                                        |
| `nocoverage.json`          | From `survivor`: #5 NoCoverage, `coveredBy: []`, #3 Killed.                                                                   |
| `disable-all.json`         | From `survivor`: `// Stryker disable all` inserted as line 2, every mutant Ignored.                                           |
| `disable-unjustified.json` | From `survivor`: a next-line directive without `: équivalent: ` as line 7, #5 Ignored.                                        |
| `equivalent.json`          | From `survivor`: a justified next-line directive as line 7, #5 Ignored.                                                       |
| `missing-file.json`        | No file, `config.mutate` empty.                                                                                               |
| `no-mutant.json`           | No file, `src/math.mjs` in `config.mutate`.                                                                                   |
| `covered-by-feature.json`  | #0 without `coveredBy`, #1 covered by `green.feature` (no `static` field), #3 by both features, #4 static; `mod/a/src/a.mjs`. |
| `no-coverage-data.json`    | `covered-by-feature` without any `coveredBy` (a run without perTest coverage).                                                |
| `unsorted.json`            | For `debt`, see below.                                                                                                        |
| `partial-line.json`        | From `survivor`: #9 added (synthetic, no real Stryker report holds it), `BlockStatement` Survived, 2:27 to 3:11.              |

## Mutation debt fixtures

`debt/` holds registries (`features/debt.feature`, steps in `features/steps/debt.ts`). Each entry is written from the
Stryker locations of the report named below, `original` being the source text between start and end.

| File                        | What                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `debt/empty.json`           | No entry.                                                                                                             |
| `debt/survivor.json`        | `survivor.json` #5 (also `nocoverage.json` #5): `src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0"`.        |
| `debt/block-0.json`         | `survivor.json` #0 `BlockStatement`, lines 2 to 4: `original` spans three lines (`{`, `  return a + b;`, `}`).        |
| `debt/block-2.json`         | `survivor.json` #2 `BlockStatement`, lines 6 to 8: three lines too, another start column (31) and end column (2).     |
| `debt/partial-line.json`    | `partial-line.json` #9: `original` is `{` then `  return a`, the end being before the end of line 3.                  |
| `debt/a-and-survivor.json`  | `debt/a-survivor.json` then `debt/survivor.json`: two files, for the plan that holds only the removed entry file.     |
| `debt/a-survivor.json`      | `covered-by-feature.json` #7: `mod/a/src/a.mjs:1:28-1:33 ArithmeticOperator "n + 1" -> "n - 1"` (a mutant on line 1). |
| `debt/duplicate.json`       | `debt/survivor.json` twice.                                                                                           |
| `debt/unknown-key.json`     | `{"survivors": [], "extra": 1}`: rejected by the strict schema.                                                       |
| `debt/negative-column.json` | `debt/survivor.json` with `start.column` -1: rejected by the schema.                                                  |
| `debt/unsorted.json`        | The registry `test-gate debt` must write from `mutation/unsorted.json`, byte for byte.                                |

`mutation/unsorted.json` derives from `covered-by-feature.json` (`src/math.mjs` first, then `mod/a/src/a.mjs`):

- `src/math.mjs` mutants in the order #6, #3, #5, #4, #8, #1, #2, #0, so the report order is not the sorted order;
  statuses #0 Survived, #1 Survived, #3 Survived, #4 Survived, #5 NoCoverage (`coveredBy: []`), #2 Timeout, #6 Killed:
  only Survived and NoCoverage enter the registry.
- #8 is added (synthetic, no real Stryker report holds it): `StringLiteral` `""` on line 3, columns 3 to 15
  (`return a + b`), Survived. It shares a line with #1 (columns 10 to 15) and sorts after it by mutator, before it by
  column: the column decides.
- #3 `true` and #4 `false` (same position and mutator) sort by replacement; #5 `EqualityOperator` after them by mutator.
- The source of `mod/a/src/a.mjs` gets two comment lines first, so its mutant #7 is on line 3 (column 28 to 33): by line
  alone it would sort among the `src/math.mjs` entries, by file it comes first.
