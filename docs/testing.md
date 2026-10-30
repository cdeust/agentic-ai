# Testing

Every test is a Gherkin scenario run by `@cucumber/cucumber` (`npm test` is `cucumber-js`). Typecheck, format and the architecture guard are scenarios too, so `npm run check` is `npm test`. No test calls the network or Anthropic. The CI gate (`npm run gate`, `docs/design/platform-v3-srt.md` §7) adds the pickle count and mutation testing on top.

## Three families

| Family     | Where                                                                                 | What it proves                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| End to end | `features/<area>/*.feature`, steps in `features/steps`, support in `features/support` | Cross-cutting behaviour with the real thing: real srt sandboxes (`features/sandbox`), real Postgres (`@postgres`), the guard, the repository, descriptive files.                 |
| Unit       | `<component>/features/*.feature`, steps in `<component>/features/steps`               | One layer in isolation, ports replaced by in-memory adapters or small fakes; port contracts as `Scenario Outline`s.                                                              |
| Mutation   | Stryker, run by `npm run gate` on the production lines the diff changed               | The scenarios kill every mutant of a changed line. A surviving mutant fails the gate; an equivalent is marked `// Stryker disable next-line <Mutator>: équivalent: <invariant>`. |

Components: `packages/contracts`, `packages/sandbox`, `data`, `gateway`, `services/memory`, `tools/test-gate`. Areas of root `features/`: `integration`, `arch`, `descriptive`, `infra`, `repository`, `sandbox`. `features/sandbox/` holds only scenarios that start real srt sandboxes (Linux and macOS); where srt cannot run, they fail, never skip.

## Rules of the suite

- One `cucumber.mjs`: `paths` over both layouts, `retry: 0`, `strict: true`, no `tags`, no `name`. A skipped, pending or undefined step is a failure.
- No computed `Examples` table: every row is literal in the `.feature`.
- Step text is unique across the repository (all steps load in one run; an ambiguous step fails).
- Steps are strict TypeScript using `node:assert/strict`, typechecked by `npm run typecheck`.
- No scenario is conditional on the host. A scenario that needs Postgres or srt and cannot get it fails.

## Running

```bash
npm test                              # every scenario (cucumber-js); also `npm run check`
npx cucumber-js <path>.feature        # adds to the configured paths, see below
npm run gate                          # plan, cucumber, Stryker on the perimeter, verdict
npm run gate -- --job macos           # features/sandbox only
```

Positional paths given to `cucumber-js` are merged with the `paths` of `cucumber.mjs`; they add to the run instead of narrowing it. To run one feature, use a profile or a throwaway config naming only that path (`npx cucumber-js --config <file>`). The `macos` profile of `cucumber.mjs` runs `features/sandbox` alone.

## Migration from vitest

Brick 1a replaced vitest. One vitest `it` became one `Scenario`, one `it.each` row one `Examples` row, a contract suite over N adapters a `Scenario Outline` with N rows. The 6 tests that `skipIf` had skipped now run. Base at `e525b50`: 224 vitest tests, 224 pickles.

| Component / area     | vitest | pickles | Features (pickles)                                                                                                                   |
| -------------------- | -----: | ------: | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts` |      7 |       7 | `result` 3, `tools` 4                                                                                                                |
| `data`               |     32 |      32 | `data-store-contract` 12, `http-api` 3, `operations` 6, `sql-store` 11                                                               |
| `gateway`            |     25 |      25 | `adapters` 12, `call-tool` 6, `mcp-server` 7                                                                                         |
| `services/memory`    |     38 |      38 | `data-client` 2, `intent-service` 10, `internal-http` 2, `internal-tools` 2, `mcp-server` 2, `ports` 1, `run-worker` 8, `runners` 11 |
| `packages/sandbox`   |     54 |      54 | `auth-proxy` 11, `credential` 3, `profile` 18, `runner-contract` 7, `tool` 5, `worktree` 5                                           |
| root (`features/`)   |     68 |      68 | `descriptive/builder-guard` 51, `descriptive/claude-files` 6, `infra/compose` 6, `integration/end-to-end` 3, `arch/guard` 2          |
| **Total migrated**   |    224 |     224 |                                                                                                                                      |

Added after the migration: `tools/test-gate` 99 (`configuration` 20, `count` 9, `diff` 2, `mutation` 37, `outcome` 14, `outputs` 10, `sets` 7), the Postgres watchdog 1 (`infra/postgres-watchdog`), `features/sandbox/srt-runner` 5 (real srt; the old `runIf(darwin)` suite), and `features/repository` 2 (typecheck, format). The suite holds 326 pickles.

## `@postgres`: a disposable database

Scenarios tagged `@postgres` (the `postgres` rows of the data-store contract) get a real database from the hook in `features/support/postgres.ts`: the first one starts a disposable Postgres 17 with pgvector, from `PG_BIN` or the `pg_ctl` found on `PATH`, listening on a Unix socket only (no TCP), and each scenario gets a fresh database. Without a PostgreSQL the scenario fails; it is never skipped. A detached watchdog (`features/support/pg-watchdog.mjs`) stops the server and removes its directory when the test process is gone, however it died (Stryker kills its workers, so `AfterAll` may never run, and an orphan server keeps a SysV shared memory segment; macOS allows 32); `features/infra/postgres-watchdog.feature` proves it with a SIGKILL.

## End to end

`features/support/harness.ts` builds the stack:

- client to gateway and gateway to memory use the SDK's `InMemoryTransport` (real MCP framing);
- memory reaches data over a real local HTTP server (port 0) running the data API with the in-memory store;
- the `ContainerRunner` is `InProcessContainerRunner`, which executes the real worker core (`runWorker`) with a scripted agent instead of a container and instead of the SDK.

Cases: `recall` after `remember` returns `status: ok` with validated data, evidence and cost, and the run holds the events `run.created, worker.started, worker.exited, output.validated, run.completed`; an invalid worker output returns `status: failed`, `error.code: WORKER_OUTPUT_INVALID`, and the run holds `output.invalid`; an agent crash returns `WORKER_FAILED`.

## Port contracts

A contract is one `Scenario Outline` per case with one `Examples` row per adapter. Adding an adapter means adding one row to each outline. Example: `data/features/data-store-contract.feature` runs the same six cases on `in-memory` and on `postgres`. The `Examples` of `features/descriptive/claude-files.feature` list the committed `.claude/agents` and `.claude/commands` files: a new file adds its row.

## Descriptive files

Each descriptive file is loaded by its scenarios exactly as production loads it, checked against its schema, and a broken copy is shown to be rejected:

| File                                                                    | Scenarios                                                                             | Broken copies rejected                                                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `data/sql/operations.json` and `data/sql/*.sql`                         | `data/features/sql-store.feature`                                                     | missing or unknown operation, `$n` count different from `params`, unknown field, missing file, not JSON              |
| `services/memory/worker/prompts/<tool>.md`                              | `services/memory/features/run-worker.feature`                                         | missing prompt, empty prompt                                                                                         |
| `packages/sandbox/profiles/builder.json`, `packages/sandbox/code.json`  | `packages/sandbox/features/profile.feature`, `packages/sandbox/features/tool.feature` | misspelt or weakening srt key, literal token, foreign base URL, plain-http upstream, unanchored route, empty command |
| `.claude/agents/*.md`, `.claude/commands/*.md`, `.claude/settings.json` | `features/descriptive/claude-files.feature`                                           | no frontmatter, missing `description`, misspelt field                                                                |
| `compose.yaml`                                                          | `features/infra/compose.feature`                                                      | (zone assertions)                                                                                                    |

The end-to-end scenarios load the committed prompts and assert the agent received them.

## Repository and architecture guard

`features/repository/repository.feature`: "the repository typechecks" runs `tsc -b` on the root `tsconfig.json`, "the repository is formatted" runs `prettier --check .`; both show the tool output when they fail. Validation of the Claude Code plugin (`claude plugin validate --strict`) needs the Claude Code binary, which CI runners do not have: it belongs to brick 1c.

`.dependency-cruiser.cjs` holds the rules (layers, no cross-component import, `pg` / agent SDK / MCP SDK / `child_process` / srt confinement, no cycles, worker self-containment). `features/arch/guard.feature` writes one temporary violating file per rule under the real component directories, runs the guard, asserts each rule fires on its file, deletes the files and asserts the tree is green again. To see it by hand:

```bash
echo "import 'pg';" > gateway/src/application/zz-tmp.ts && npm run arch   # red
rm gateway/src/application/zz-tmp.ts && npm run arch                      # green
```

## Known gaps

- `services/memory/worker/sdk-agent.ts` is not exercised against the live SDK in the default suite (needs the broker and an API key).
- Docker images and `docker compose up` are not exercised by CI; `compose.yaml` is validated structurally.

## Checklist for a new brick

1. Unit scenarios in `<component>/features/` for each layer it touches.
2. A `Scenario Outline` contract for each new port, one `Examples` row per adapter.
3. An end-to-end scenario in `features/integration/` if it is on the path of a call, including a failure with a named `error.code`.
4. A guard rule and a fixture row in `features/arch/guard.feature` if it adds a boundary.
5. A load-and-schema scenario with a broken copy for each descriptive file.
6. 0 surviving mutant on the changed production lines.
7. `npm run check` green.
