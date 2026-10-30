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
