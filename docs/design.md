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
- Rejected: separate vector database. One more system to run and secure for the current scale; the port (`MemoryRepository`) keeps the option open.

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
