# architect-os

A four-tier MCP system. Clients call one intent tool on a single gateway; the owning service runs a sandboxed Claude Agent SDK worker and answers with a validated `Result`. Data access lives in one typed component.

```
client --> proxy --> gateway --> services/memory --> worker (container)
                                        |
                                        +--> data --> postgres + pgvector
```

| Path                  | Role                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| `proxy/`              | Caddyfile; the only exposed component (`/mcp`, `/healthz`).            |
| `gateway/`            | Single MCP server for clients: auth, catalogue, routing, quota, audit. |
| `services/memory/`    | Intent tools `recall` and `remember`; `worker/` is the agent image.    |
| `data/`               | The only component that imports `pg`; typed operations from `sql/`.    |
| `packages/contracts/` | `Result<T>`, `Run`, `RunEvent`, zod tool schemas.                      |
| `docs/`               | Architecture, infrastructure, design decisions, agents, testing.       |

The architecture is enforced, not just described: `npm run arch` fails on a wrong layer import, a cross-component import, `pg` outside `data/src/infrastructure`, the agent SDK outside a worker, the MCP SDK outside presentation/infrastructure, or a cycle.

## Quick start

Requires Node 26 LTS (`.nvmrc`) and npm.

```bash
nvm use            # or any Node 26
npm ci
npm run check      # typecheck, prettier, tests, architecture guard
```

The end-to-end test (`features/integration/end-to-end.feature`) runs a `recall` through gateway, memory, worker and data in one process, with a scripted agent and no network.

## Local stack

```bash
cp .env.example .env           # fill the placeholders
docker compose build
docker compose --profile build-only build memory-worker
docker compose up
curl http://127.0.0.1:8080/healthz
```

Workers need the secrets broker to reach Anthropic; it is not part of this skeleton (see `docs/infrastructure.md`).

## Working with Claude

`CLAUDE.md` holds the commands, boundaries and the "what the review must refuse" list. `.claude/agents/` has three review subagents, `.claude/commands/review-pr.md` runs them, and `.github/workflows/` runs Claude on `@claude` mentions and on pull requests (workflows from `anthropics/claude-code-action`).

## Documentation

[Architecture](docs/architecture.md) | [Infrastructure](docs/infrastructure.md) | [Design decisions](docs/design.md) | [Agents](docs/agents.md) | [Testing](docs/testing.md) | [Contributing](CONTRIBUTING.md) | [Security](SECURITY.md) | [Changelog](CHANGELOG.md)

## License

MIT, see [LICENSE](LICENSE).
