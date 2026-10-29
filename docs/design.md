# Design decisions

Short ADRs. Format: context, decision, alternative rejected and why. Status of all: accepted (skeleton).

## 1. One exposed component, one MCP surface

- Context: clients need one stable entry point; services change independently.
- Decision: a proxy is the only exposed component; the gateway is the only MCP server clients see.
- Rejected: expose each service to clients. It multiplies auth, quota and audit implementations and leaks internal topology.

## 2. Gateway without business logic

- Decision: the gateway does auth, catalogue, routing per tool, quota, audit. It runs no agent and touches no data.
- Rejected: put orchestration in the gateway. It would become the monolith again and could not be reasoned about as a pure router.

## 3. Intent tools backed by an agent worker

- Decision: services expose intent tools (`recall`, `remember`) with zod input and output schemas; the work is done by a Claude Agent SDK agent inside a worker using the service's internal tools only.
- Rejected: expose low-level tools (search, insert) to clients and let the client agent compose them. It moves cost, limits and validation to every client and gives no single place to validate output.

## 4. Workers as short-lived containers behind a port

- Decision: `ContainerRunner` port; one container per execution; read-only filesystem, no capabilities, non-root, memory/pids/time limits, `exec` network only. Adapters: Docker CLI (local), in-process (tests).
- Rejected: run the agent inside the service process (no isolation of model-driven tool use); long-lived worker pool (state leaks between runs).
- Known limit: the local Docker adapter needs the Docker socket. Production should use an orchestrator adapter (job API with a restricted service account) behind the same port.

## 5. Data as the only database component, with typed operations

- Decision: only `data` imports `pg`; operations are named and schema-typed; no SQL in any other component; HTTP API (not MCP) because the MCP SDK is restricted to gateway and services.
- Rejected: each service owns its database access (SQL spreads, no single audit point); a generic SQL tool (SQL injection by construction and unreviewable access).

## 6. Postgres with pgvector

- Decision: one Postgres holds the run registry and memory vectors.
- Rejected: separate vector database. One more system to run and secure for the current scale; the port (`DataStore`) keeps the option open.

## 7. `packages/contracts` is the only shared code

- Decision: `Result<T>`, `Run`, `RunEvent`, tool and data-operation schemas, worker wire format. Schemas, no logic.
- Rejected: duplicate types per component (drift); a shared domain library (couples components, defeats the boundary rule).

## 8. `Result` envelope with named failures

- Decision: every intent tool returns a `Result`; failures are values with `error.code`; the service validates worker output before answering.
- Rejected: throw exceptions across the service boundary (the client cannot tell a bad input from a crashed worker); trust worker output (a prompt-injected agent could return anything).

## 9. Layered components with ports and in-memory adapters

- Decision: domain, application, infrastructure, presentation; constructor injection; one composition root; an in-memory adapter for every port.
- Rejected: framework-style DI container or service locator (hidden dependencies, harder to prove boundaries). In-memory adapters make the end-to-end test possible without Docker or network.

## 10. Architecture enforced by a tool, not by convention

- Decision: dependency-cruiser rules run in `npm run check`; a test writes violating fixtures and asserts the guard turns red.
- Rejected: documentation and review only. Reviewers miss imports; CI does not.

## 11. npm, TypeScript, descriptive files for Claude

- Decision: npm workspaces, Node 26 LTS (`.nvmrc`), exact dependency versions, committed lockfile, tsc strict, prettier, vitest. Instruction files follow the Claude Code documentation: `CLAUDE.md`, `.claude/settings.json`, `.claude/agents/`, `.claude/commands/`; CI follows `anthropics/claude-code-action`.
- Rejected: bun (Anthropic's repositories use it; this project chose npm). TypeScript 7.0.x: `dependency-cruiser@18.7.0` supports TypeScript below 7 (it reported `missing-tsc-transpiler` and cruised zero modules), so TypeScript is pinned to 6.0.3 until dependency-cruiser supports 7.
- `CLAUDE.md` references `docs/` by path instead of `@docs/...` imports: the Claude Code memory documentation states that imports load with the importing file and do not reduce context cost.

## 12. Behaviour in descriptive files, code reduced to loaders, executors and security floors

- Context: per-case TypeScript (one repository method per SQL statement, one hand-written tool per internal tool, prompts as string constants, one error class per failure, a catalogue class over a table that already existed) grew with every operation and tool. Anthropic's own extension points are descriptive files (`CLAUDE.md`, `.claude/agents/*.md`, skills, commands) precisely to keep that out of code.
- Rule: a behaviour that a descriptive file can express is not written in code. Code is reserved for protocol translation (MCP, HTTP), process and container control, validation against a schema, security floors, and one generic loader or executor per kind of file. Every descriptive file has a load-and-schema test with a rejected broken copy.
- Decision, data: each operation is a named file `data/sql/<op>.sql`; `data/sql/operations.json` declares, per operation, the file, the input fields bound to `$1..$n` (`:json` for jsonb and vector), the shape of the answer, an optional `when` field choosing a variant (vector or text search), and the SQLSTATEs that mean a named failure. One executor (`SqlDataStore`) runs them; `DataOperations` checks input and output against `DATA_OPS`. The loader refuses a table that misses an operation, names an unknown one, or whose `params` length differs from the highest `$n` of its SQL. "A completed run cannot be completed again" moved from TypeScript to the database (`migrations/0003_runs_immutable.sql`, trigger raising 55000). The repositories `PostgresRunRepository` and `PostgresMemoryRepository`, the clock and id ports and two error classes are gone.
- Decision, worker: system prompts are `services/memory/worker/prompts/<tool>.md`, loaded at start; internal tools are declared once in `INTERNAL_TOOLS` (contracts) as views of a data operation, and the SDK tool list, the `allowedTools` list, the internal HTTP endpoint and its validation are loops over that table. Evidence is derived generically from returned records carrying an `id`. The worker no longer has its own default limits: `WorkerInput.limits` is required and set by the service.
- Decision, gateway: no catalogue class and no list use case; the gateway iterates `TOOLS`, and its routes are the owners of `TOOLS`, each read from `<OWNER>_URL`. One `GatewayError` class with a code replaces four classes; likewise one `ServiceError` in services and one `DataError` in data.
- Measured (`git ls-tree -r` of each commit, TypeScript outside `test/` and `*.test.ts`, lines by `wc -l`): 46 modules and 2209 lines at the skeleton commit, 43 modules and 1963 lines after (-11 %). Part of the difference is SQL text that moved out of TypeScript strings into `data/sql/`. Added descriptive files: 8 SQL statements, `operations.json`, one migration, two prompts. Tests grew (1637 to 1854 lines) with the shared `DataStore` contract, the loader tests and the `.claude` file tests.
- What stays code, and why:
  - zod schemas in `packages/contracts` stay the single source; types and JSON Schema (`z.toJSONSchema` for `outputFormat`) are derived. JSON Schema files were rejected as the source: turning them back into validators needs `z.fromJSONSchema`, which `zod/v4/classic/from-json-schema.d.ts` (4.6.7) marks "semi-experimental. It's behavior is liable to change", and the MCP SDK's `registerTool` takes zod schemas.
  - The worker keeps `settingSources: []` and reads its prompt itself instead of loading `.claude/agents/<tool>.md` through the SDK: the SDK path needs `settingSources: ['project']`, which also loads `CLAUDE.md` from `cwd` and its parents and project hooks, and the SDK documentation recommends `settingSources: []` for multi-tenant isolation (code.claude.com/docs/en/agent-sdk/claude-code-features). `tools: []`, `allowedTools`, `permissionMode`, `strictMcpConfig`, `persistSession` stay in code because they are the security floor.
  - The in-memory adapters (`InMemoryDataStore`, gateway and service fakes) stay code: they are test doubles and run the same contract suites as the real adapters.
  - Row normalisation (timestamps to ISO strings, SQL NULL to an absent field) and SQLSTATE mapping are a few generic lines in the executor, not per operation.
  - `IntentService` (run lifecycle, Result mapping), `DockerContainerRunner` (isolation flags, timeout kill), the MCP and HTTP hosts, and the composition roots are protocol, process control or wiring. The two `http-host.ts` files are near duplicates by necessity: components share no code except contracts, which holds no logic.
  - Gateway scopes are not introduced: no scope exists in the identity model today, and adding one is a feature, not a reduction.
- Rejected: an embedded Postgres (PGlite) as the in-memory store, which would have removed `in-memory.ts` and run the SQL on every `npm test`: a 26 MB WASM dependency whose latest versions were days old at the time; the real-database contract suite (`TEST_DATABASE_URL`) covers the SQL instead.
