# CLAUDE.md

## Commands

```bash
npm ci                 # Install (Node 26 LTS, see .nvmrc; exact versions, lockfile committed)
npm test               # cucumber-js: every scenario (unit, port contracts, end to end, typecheck, format, architecture guard)
npm run gate           # the CI gate (docs/design/platform-v3-srt.md §7): plan, cucumber, Stryker on the perimeter, verdict
npm run gate -- --job macos   # features/sandbox only
npm run check          # = npm test. Must be green before every PR.
npm run typecheck      # tsc -b, strict (also a scenario)
npm run format:check   # prettier --check (npm run format to fix; also a scenario)
npm run arch           # dependency-cruiser: layers, boundaries, cycles (also a scenario)
npm --prefix <launcher checkout> run code   # from a worktree: claude under srt, builder profile (packages/sandbox/README.md)
```

## What This Is

A four-tier MCP system. A client calls one intent tool; the gateway routes it to the owning service; the service runs a sandboxed Claude Agent SDK worker and returns a validated `Result`.

```
client -> proxy -> gateway -> services/<name> -> worker (container, exec network)
                                   |
                                   +-> data -> postgres (pgvector)
```

| Dir                   | Role                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `proxy/`              | Caddyfile. Only exposed component: `/mcp` to the gateway, `/healthz`.                                                            |
| `gateway/`            | The single MCP server for clients. Auth, tool catalogue, routing per tool, quotas, audit. Nothing else.                          |
| `services/memory/`    | Intent tools `recall` / `remember`. `src/` is the MCP service, `worker/` is the agent image.                                     |
| `data/`               | Only component that imports `pg`. Typed operations served from `sql/` by one executor; migrations.                               |
| `packages/contracts/` | Only shared package: `Result<T>`, `Run`, `RunEvent`, zod schemas of tools and data operations. No logic.                         |
| `packages/sandbox/`   | `SandboxRunner` port, srt adapter, builder profile template, host auth proxy, `npm run code` (brick 1a.0).                       |
| `tools/test-gate/`    | The CI gate (`npm run gate`). Layers `domain`, `infrastructure`, composition root `src/main.ts`.                                 |
| `features/`           | End-to-end and cross-cutting scenarios (`integration`, `arch`, `descriptive`, `infra`, `repository`, `sandbox`).                 |
| `bench/`              | Outside production: nothing in production imports it, the gate neither counts nor mutates it (DC-8). No dependency-cruiser rule. |

Details: `docs/architecture.md`, `docs/infrastructure.md`, `docs/design.md`, `docs/agents.md`, `docs/testing.md`.

## Layers (gateway, services/*, data)

Each component has `src/domain`, `src/application`, `src/infrastructure`, `src/presentation`, `features/`, and one composition root `src/main.ts`.

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

Every descriptive file has a scenario that loads the committed file, checks it against its schema, and shows that a broken copy is rejected; a broken file makes `npm run check` red.

## Hard boundaries (enforced by `npm run arch`)

- `pg` only in `data/src/infrastructure`. SQL only in `data/sql/` and `data/migrations/`, executed only by `data/src/infrastructure`. No DB access anywhere else. Data exposes typed operations, never free-form SQL.
- `@anthropic-ai/claude-agent-sdk` only in `services/*/worker`.
- `@modelcontextprotocol/sdk` only in `presentation` and `infrastructure` of `gateway` and `services/*`, and in their `features/` (step definitions).
- `node:child_process` only in `packages/sandbox`, with two named exceptions in `.dependency-cruiser.cjs`: `services/memory/src/infrastructure/docker-runner.ts` (until brick 1b.1) and `tools/test-gate/src/infrastructure/git.ts` (the one file through which the gate runs git). `@anthropic-ai/sandbox-runtime` only in `packages/sandbox`, no exception.
- No import cycles.
- The gateway and the proxy contain no business logic: the gateway runs no agent and touches no data.

## Adding a brick

Every new brick (tool, port, adapter, component, worker) arrives with its tests and passes `npm run check`:

Tests are Gherkin scenarios (`@cucumber/cucumber`; steps in TypeScript, step text unique across the repository):

1. Unit scenarios per layer it touches, in `<component>/features/` (steps in `<component>/features/steps/`).
2. A contract for each port it defines: a `Scenario Outline` with one `Examples` row per adapter, the in-memory one included.
3. If it is on the path of a call, an end-to-end scenario in `features/integration/` (client -> gateway -> service -> worker with a scripted agent -> data in memory).
4. If it adds a boundary, a rule in `.dependency-cruiser.cjs` and a fixture scenario row in `features/arch/`.
5. If it adds a descriptive file, a load-and-schema scenario with a rejected broken copy.
6. A changed production line has 0 surviving mutant (the gate, doc §7). An equivalent mutant is marked `// Stryker disable next-line <Mutator>: équivalent: <invariant>`.

Common bricks need no new TypeScript:

- Intent tool: its zod schemas and owner in `TOOLS` (`packages/contracts/src/tools.ts`) and `services/<owner>/worker/prompts/<tool>.md`. The gateway catalogue, the gateway route and the service registration are derived.
- Internal tool: one entry in `INTERNAL_TOOLS` (`packages/contracts/src/data-ops.ts`) naming the data operation it is a view of.
- Data operation: its schemas in `DATA_OPS`, `data/sql/<op>.sql`, a row in `data/sql/operations.json`, and, for the in-memory store, one handler in `data/src/infrastructure/in-memory.ts`. The shared `DataStore` contract runs on both stores.

## Conventions

- TypeScript strict, ESM, `.js` suffix in relative imports. Prettier formats (`npm run format`).
- Dependencies are pinned to exact versions; verify with `npm view <pkg> version`; commit `package-lock.json`.
- Never invent an SDK API: read the published `.d.ts` under `node_modules/<pkg>` and cite the file in the comment.
- Failures are values: a tool call returns `Result` with `status: 'failed'` and a named `error.code`; do not throw across a service boundary.
- Secrets go through the secrets broker only (brick 1a.0: the host auth proxy of `packages/sandbox` alone holds the owner's Claude credential; the sandbox gets a session token). Never put an API key, token or password in a worker container, an image, the repository, a log or a test.
- Never compare a branch to `main` (no merge-base, no branch tip comparison, no update-branch) in CI, scripts or tools. Review the PR diff as GitHub presents it. One written exception: the gate (`tools/test-gate`) diffs the working tree against the first parent `HEAD^1` (in a PR, the first parent of GitHub's merge commit, i.e. the PR diff as GitHub presents it; on `main`, the previous commit) to derive added and removed pickles, the changed lines and the `.feature` diff. No merge-base, no branch tip, no update-branch.
- Commits: imperative subject, no attribution trailer.

## What the review must refuse

Request changes on a PR that has any of these:

- A brick without tests (see "Adding a brick"), or a port without a contract test, or a path-of-call change without an end-to-end case.
- An import that violates the guard, or a change that weakens `.dependency-cruiser.cjs` or removes a guard fixture.
- Any database access (`pg`, SQL strings) outside `data/` (`sql/`, `migrations/`, `src/infrastructure`), or a data operation that accepts free-form SQL.
- Business logic in `gateway/` or `proxy/` (anything beyond auth, catalogue, routing, quota, audit).
- Agent execution outside `services/*/worker`, or a worker that gets a secret, the Docker socket, or a route to `data`/`postgres`.
- A Result path that throws instead of returning a named failure, or worker output used without schema validation.
- Behaviour written in code where a descriptive file can express it (see "Descriptive files before code"), or a descriptive file without its load-and-schema scenario.
- A branch-to-`main` comparison in CI or tooling, an unpinned dependency (`^`, `~`, `latest`), or a lockfile out of sync.
- A `tags`, `name` or `retry` option in `cucumber.mjs`, a skipped, pending or undefined step, or a computed `Examples` table.
- A `Stryker disable` that lacks the justified form `// Stryker disable next-line <Mutator>: équivalent: <invariant>`.
- A change to `tools/test-gate` or `.github/workflows/gate.yml` that the PR does not explain (R-6).
- Docs (`docs/`, this file) left stale by a change that alters architecture, boundaries or commands.

Reviewers: use `/review-pr` (`.claude/commands/review-pr.md`); it delegates to `architecture-reviewer`, `test-reviewer` and `security-reviewer` in `.claude/agents/`.
