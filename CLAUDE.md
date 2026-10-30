# CLAUDE.md

## Commands

```bash
npm ci                 # Install (Node 26 LTS, see .nvmrc; exact versions, lockfile committed)
npm run typecheck      # tsc -b, strict
npm run format:check   # prettier --check (npm run format to fix)
npm test               # vitest run: unit, port contracts, end to end, architecture guard
npm run arch           # dependency-cruiser: layers, boundaries, cycles
npm run check          # all four. Must be green before every PR.
npm --prefix <launcher checkout> run code   # from a worktree: claude under srt, builder profile (packages/sandbox/README.md)
```

## What This Is

A four-tier MCP system. A client calls one intent tool; the gateway routes it to the owning service; the service runs a sandboxed Claude Agent SDK worker and returns a validated `Result`.

```
client -> proxy -> gateway -> services/<name> -> worker (container, exec network)
                                   |
                                   +-> data -> postgres (pgvector)
```

| Dir                   | Role                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `proxy/`              | Caddyfile. Only exposed component: `/mcp` to the gateway, `/healthz`.                                    |
| `gateway/`            | The single MCP server for clients. Auth, tool catalogue, routing per tool, quotas, audit. Nothing else.  |
| `services/memory/`    | Intent tools `recall` / `remember`. `src/` is the MCP service, `worker/` is the agent image.             |
| `data/`               | Only component that imports `pg`. Typed operations served from `sql/` by one executor; migrations.       |
| `packages/contracts/` | Only shared package: `Result<T>`, `Run`, `RunEvent`, zod schemas of tools and data operations. No logic. |
| `packages/sandbox/`   | `SandboxRunner` port, srt adapter, builder profile template, `npm run code` (brick 1a.0).                |

Details: `docs/architecture.md`, `docs/infrastructure.md`, `docs/design.md`, `docs/agents.md`, `docs/testing.md`.

## Layers (gateway, services/*, data)

Each component has `src/domain`, `src/application`, `src/infrastructure`, `src/presentation`, `test/`, and one composition root `src/main.ts`.

- `domain` imports only `domain` and `@architect-os/contracts`. It holds entities and **ports** (interfaces).
- `application` imports `domain`. Use cases, constructor-injected ports.
- `infrastructure` imports `domain` and `application`. **Adapters**, with an in-memory adapter for every port.
- `presentation` imports `application`. MCP or HTTP translation only.
- `src/main.ts` is the only place that builds objects. No service locator, no global singleton, nothing imports `main.ts`.
- No import between components. They talk over the network; the only shared code is `@architect-os/contracts`.

## Descriptive files before code

A behaviour that a descriptive file can express is not written in code. Code is reserved for what a file cannot carry: protocol translation (MCP, HTTP), process and container control, validation against a schema, security floors (tool allow-lists, isolation flags, secrets), and one generic loader or executor per kind of file.

| Behaviour                           | Descriptive file                                               | Read by                                    |
| ----------------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| Data operation (SQL)                | `data/sql/<op>.sql` + one row in `data/sql/operations.json`    | `data/src/infrastructure/sql-store.ts`     |
| Database invariant                  | `data/migrations/NNNN_name.sql` (constraint, trigger)          | `data/src/infrastructure/migrate.ts`       |
| Worker system prompt per tool       | `services/<name>/worker/prompts/<tool>.md`                     | `services/<name>/worker/prompts.ts`        |
| Intent tool, internal tool, data op | declarative zod tables in `packages/contracts` (single source) | generic loops in gateway, services, worker |
| Review agents and commands          | `.claude/agents/*.md`, `.claude/commands/*.md`                 | Claude Code                                |

Every descriptive file has a test that loads the committed file, checks it against its schema, and shows that a broken copy is rejected; a broken file makes `npm run check` red.

## Hard boundaries (enforced by `npm run arch`)

- `pg` only in `data/src/infrastructure`. SQL only in `data/sql/` and `data/migrations/`, executed only by `data/src/infrastructure`. No DB access anywhere else. Data exposes typed operations, never free-form SQL.
- `@anthropic-ai/claude-agent-sdk` only in `services/*/worker`.
- `@modelcontextprotocol/sdk` only in `presentation` and `infrastructure` of `gateway` and `services/*` (and their tests).
- `child_process` and `@anthropic-ai/sandbox-runtime` only in `packages/sandbox` (named exception: `services/memory/src/infrastructure/docker-runner.ts`, until brick 1b.1).
- No import cycles.
- The gateway and the proxy contain no business logic: the gateway runs no agent and touches no data.

## Adding a brick

Every new brick (tool, port, adapter, component, worker) arrives with its tests and passes `npm run check`:

1. Unit tests per layer it touches (domain, application, infrastructure, presentation).
2. A contract test for each port it defines, run against every adapter including the in-memory one.
3. If it is on the path of a call, an end-to-end case in `test/integration/` (client -> gateway -> service -> worker with a scripted agent -> data in memory).
4. If it adds a boundary, a rule in `.dependency-cruiser.cjs` and a fixture case in `test/arch/guard.test.ts`.
5. If it adds a descriptive file, a load-and-schema test with a rejected broken copy.

Common bricks need no new TypeScript:

- Intent tool: its zod schemas and owner in `TOOLS` (`packages/contracts/src/tools.ts`) and `services/<owner>/worker/prompts/<tool>.md`. The gateway catalogue, the gateway route and the service registration are derived.
- Internal tool: one entry in `INTERNAL_TOOLS` (`packages/contracts/src/data-ops.ts`) naming the data operation it is a view of.
- Data operation: its schemas in `DATA_OPS`, `data/sql/<op>.sql`, a row in `data/sql/operations.json`, and, for the in-memory store, one handler in `data/src/infrastructure/in-memory.ts`. The shared `DataStore` contract runs on both stores.

## Conventions

- TypeScript strict, ESM, `.js` suffix in relative imports. Prettier formats (`npm run format`).
- Dependencies are pinned to exact versions; verify with `npm view <pkg> version`; commit `package-lock.json`.
- Never invent an SDK API: read the published `.d.ts` under `node_modules/<pkg>` and cite the file in the comment.
- Failures are values: a tool call returns `Result` with `status: 'failed'` and a named `error.code`; do not throw across a service boundary.
- Secrets go through the secrets broker only. Never put an API key, token or password in a worker container, an image, the repository, a log or a test.
- Never compare a branch to `main` (no merge-base, no branch tip comparison, no update-branch) in CI, scripts or tools. Review the PR diff as GitHub presents it.
- Commits: imperative subject, no attribution trailer.

## What the review must refuse

Request changes on a PR that has any of these:

- A brick without tests (see "Adding a brick"), or a port without a contract test, or a path-of-call change without an end-to-end case.
- An import that violates the guard, or a change that weakens `.dependency-cruiser.cjs` or removes a guard fixture.
- Any database access (`pg`, SQL strings) outside `data/` (`sql/`, `migrations/`, `src/infrastructure`), or a data operation that accepts free-form SQL.
- Business logic in `gateway/` or `proxy/` (anything beyond auth, catalogue, routing, quota, audit).
- Agent execution outside `services/*/worker`, or a worker that gets a secret, the Docker socket, or a route to `data`/`postgres`.
- A Result path that throws instead of returning a named failure, or worker output used without schema validation.
- Behaviour written in code where a descriptive file can express it (see "Descriptive files before code"), or a descriptive file without its load-and-schema test.
- A branch-to-`main` comparison in CI or tooling, an unpinned dependency (`^`, `~`, `latest`), or a lockfile out of sync.
- Docs (`docs/`, this file) left stale by a change that alters architecture, boundaries or commands.

Reviewers: use `/review-pr` (`.claude/commands/review-pr.md`); it delegates to `architecture-reviewer`, `test-reviewer` and `security-reviewer` in `.claude/agents/`.
