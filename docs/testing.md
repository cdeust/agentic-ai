# Testing

`npm run test:features` runs `cucumber-js` over the `features/` of every component and the root `features/` directory (vitest runs what is not yet migrated). `npm run check` adds typecheck, format and the architecture guard. No test calls the network or Anthropic.

## Pyramid

| Level              | Where                                                                   | What it proves                                                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit, per layer    | `<component>/features/*.feature`, steps in `<component>/features/steps` | Each layer in isolation, ports replaced by in-memory adapters or small fakes.                                                                                                                                                 |
| Port contracts     | `<component>/features/*.feature` (Scenario Outlines)                    | One Scenario Outline per port case, one Examples row per adapter (`DataStore`, `ContainerRunner`, `Authenticator`, `QuotaPolicy`, `AuditLog`, `ServiceClient`), run against every adapter.                                    |
| Worker             | `services/memory/features/run-worker.feature`                           | `runWorker` with a scripted `AgentPort`: ok output, agent error, bad input.                                                                                                                                                   |
| Sandbox            | `packages/sandbox/features/*.feature`, `features/sandbox/*.feature`     | Auth proxy, profile, worktree, `SandboxRunner` contract. The scenarios of `features/sandbox/` start real srt sandboxes: they run on Linux (bubblewrap, socat, ripgrep) and macOS, and fail, never skip, where srt cannot run. |
| End to end         | `features/integration/end-to-end.feature`                               | Client, gateway, memory, worker, data in one process; the run and its events are in the registry.                                                                                                                             |
| Infrastructure     | `features/infra/compose.feature`                                        | Network zones, single published port, dropped capabilities in `compose.yaml`.                                                                                                                                                 |
| Architecture guard | `features/arch/guard.feature`                                           | The guard is green on the tree and red on each kind of violation (temporary fixtures).                                                                                                                                        |

## End to end

`features/support/harness.ts` builds the stack:

- client to gateway and gateway to memory use the SDK's `InMemoryTransport` (real MCP framing);
- memory reaches data over a real local HTTP server (port 0) running the data API with the in-memory store;
- the `ContainerRunner` is `InProcessContainerRunner`, which executes the real worker core (`runWorker`) with a scripted agent instead of a container and instead of the SDK.

Cases: `recall` after `remember` returns `status: ok` with validated data, evidence and cost, and the run holds the events `run.created, worker.started, worker.exited, output.validated, run.completed`; an invalid worker output returns `status: failed`, `error.code: WORKER_OUTPUT_INVALID`, and the run holds `output.invalid`; an agent crash returns `WORKER_FAILED`.

## Port contracts

A contract is one Gherkin `Scenario Outline` per case with one `Examples` row per adapter. Adding an adapter means adding one row to each outline. Example: `data/features/data-store-contract.feature` runs the same six cases on `in-memory` and on `postgres`; the postgres rows are tagged `@postgres`, and the hook `features/support/postgres.ts` starts a disposable Postgres 17 (unix socket only, pgvector) the first time one runs, from `PG_BIN` or the `pg_ctl` found on `PATH`, with a fresh database per scenario. Without a PostgreSQL the scenario fails; it is never skipped. A detached watchdog (`features/support/pg-watchdog.mjs`) stops the server and removes its directory when the test process is gone, however it died (Stryker kills its workers, so `AfterAll` may never run, and an orphan server keeps a SysV shared memory segment; macOS allows 32); `features/infra/postgres-watchdog.feature` proves it with a SIGKILL.

The `Examples` of `features/descriptive/claude-files.feature` list the committed `.claude/agents` and `.claude/commands` files: a new file adds its row (no computed table).

## Descriptive files

Each descriptive file is loaded by its test exactly as production loads it, checked against its schema, and a broken copy is shown to be rejected:

| File                                                                    | Test                                                                                  | Broken copies rejected                                                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `data/sql/operations.json` and `data/sql/*.sql`                         | `data/features/sql-store.feature`                                                     | missing or unknown operation, `$n` count different from `params`, unknown field, missing file, not JSON              |
| `services/memory/worker/prompts/<tool>.md`                              | `services/memory/features/run-worker.feature`                                         | missing prompt, empty prompt                                                                                         |
| `packages/sandbox/profiles/builder.json`, `packages/sandbox/code.json`  | `packages/sandbox/features/profile.feature`, `packages/sandbox/features/tool.feature` | misspelt or weakening srt key, literal token, foreign base URL, plain-http upstream, unanchored route, empty command |
| `.claude/agents/*.md`, `.claude/commands/*.md`, `.claude/settings.json` | `features/descriptive/claude-files.feature`                                           | no frontmatter, missing `description`, misspelt field                                                                |
| `compose.yaml`                                                          | `features/infra/compose.feature`                                                      | (zone assertions)                                                                                                    |

The end-to-end test loads the committed prompts and asserts the agent received them.

## Architecture guard

`.dependency-cruiser.cjs` holds the rules (layers, no cross-component import, `pg` / agent SDK / MCP SDK confinement, no cycles, worker self-containment). `features/arch/guard.feature` writes one temporary violating file per rule under the real component directories, runs the guard, asserts each rule fires on its file, deletes the files and asserts the tree is green again. To see it by hand:

```bash
echo "import 'pg';" > gateway/src/application/zz-tmp.ts && npm run arch   # red
rm gateway/src/application/zz-tmp.ts && npm run arch                      # green
```

## Known gaps

- `services/memory/worker/sdk-agent.ts` is not exercised against the live SDK in the default suite (needs the broker and an API key).
- The SQL files run against a real Postgres through the `@postgres` scenarios of `data/features/data-store-contract.feature`; the statement table, parameter binding and migration order are also asserted without a database in `data/features/sql-store.feature`.
- Docker images and `docker compose up` are not exercised by CI; `compose.yaml` is validated structurally.

## Checklist for a new brick

1. Unit tests for each layer it touches.
2. A contract suite for each new port; every adapter registered in it.
3. An end-to-end case if it is on the path of a call, including a failure with a named `error.code`.
4. A guard rule and fixture if it adds a boundary.
5. `npm run check` green.
