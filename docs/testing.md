# Testing

`npm test` runs `vitest run` over every component and the root `test/` directory. `npm run check` adds typecheck, format and the architecture guard. No test calls the network or Anthropic.

## Pyramid

| Level              | Where                                                               | What it proves                                                                                                                               |
| ------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit, per layer    | `<component>/test/{domain,application,infrastructure,presentation}` | Each layer in isolation, ports replaced by in-memory adapters or small fakes.                                                                |
| Port contracts     | `<component>/test/contracts/*.ts`                                   | One suite per port (`DataStore`, `ContainerRunner`, `Authenticator`, `QuotaPolicy`, `AuditLog`, `ServiceClient`), run against every adapter. |
| Worker             | `services/memory/test/worker`                                       | `runWorker` with a scripted `AgentPort`: ok output, agent error, bad input.                                                                  |
| End to end         | `test/integration/end-to-end.test.ts`                               | Client, gateway, memory, worker, data in one process; the run and its events are in the registry.                                            |
| Infrastructure     | `test/infra/compose.test.ts`                                        | Network zones, single published port, dropped capabilities in `compose.yaml`.                                                                |
| Architecture guard | `test/arch/guard.test.ts`                                           | The guard is green on the tree and red on each kind of violation (temporary fixtures).                                                       |

## End to end

`test/integration/harness.ts` builds the stack:

- client to gateway and gateway to memory use the SDK's `InMemoryTransport` (real MCP framing);
- memory reaches data over a real local HTTP server (port 0) running the data API with the in-memory store;
- the `ContainerRunner` is `InProcessContainerRunner`, which executes the real worker core (`runWorker`) with a scripted agent instead of a container and instead of the SDK.

Cases: `recall` after `remember` returns `status: ok` with validated data, evidence and cost, and the run holds the events `run.created, worker.started, worker.exited, output.validated, run.completed`; an invalid worker output returns `status: failed`, `error.code: WORKER_OUTPUT_INVALID`, and the run holds `output.invalid`; an agent crash returns `WORKER_FAILED`.

## Port contracts

A contract suite is a function taking a factory for the adapter under test. Adding an adapter means adding one line that calls the suite. Example: `dataStoreContract('postgres', ...)` in `data/test/infrastructure/sql-store.test.ts` runs the SQL files through `SqlDataStore` and is skipped unless `TEST_DATABASE_URL` points at a disposable Postgres with pgvector; the same suite runs on the in-memory store on every `npm test`.

## Descriptive files

Each descriptive file is loaded by its test exactly as production loads it, checked against its schema, and a broken copy is shown to be rejected:

| File                                                                    | Test                                             | Broken copies rejected                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `data/sql/operations.json` and `data/sql/*.sql`                         | `data/test/infrastructure/sql-store.test.ts`     | missing or unknown operation, `$n` count different from `params`, unknown field, missing file, not JSON |
| `services/memory/worker/prompts/<tool>.md`                              | `services/memory/test/worker/run-worker.test.ts` | missing prompt, empty prompt                                                                            |
| `.claude/agents/*.md`, `.claude/commands/*.md`, `.claude/settings.json` | `test/descriptive/claude-files.test.ts`          | no frontmatter, missing `description`, misspelt field                                                   |
| `compose.yaml`                                                          | `test/infra/compose.test.ts`                     | (zone assertions)                                                                                       |

The end-to-end test loads the committed prompts and asserts the agent received them.

## Architecture guard

`.dependency-cruiser.cjs` holds the rules (layers, no cross-component import, `pg` / agent SDK / MCP SDK confinement, no cycles, worker self-containment). `test/arch/guard.test.ts` writes one temporary violating file per rule under the real component directories, runs the guard, asserts each rule fires on its file, deletes the files and asserts the tree is green again. To see it by hand:

```bash
echo "import 'pg';" > gateway/src/application/zz-tmp.ts && npm run arch   # red
rm gateway/src/application/zz-tmp.ts && npm run arch                      # green
```

## Known gaps

- `services/memory/worker/sdk-agent.ts` is not exercised against the live SDK in the default suite (needs the broker and an API key).
- The SQL files run against a real database only when `TEST_DATABASE_URL` is set; without it, the statement table, parameter binding and migration order are asserted without a database.
- Docker images and `docker compose up` are not exercised by CI; `compose.yaml` is validated structurally.

## Checklist for a new brick

1. Unit tests for each layer it touches.
2. A contract suite for each new port; every adapter registered in it.
3. An end-to-end case if it is on the path of a call, including a failure with a named `error.code`.
4. A guard rule and fixture if it adds a boundary.
5. `npm run check` green.
