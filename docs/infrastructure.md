# Infrastructure

## Local stack (`compose.yaml`)

```bash
cp .env.example .env        # fill placeholders; never commit .env
docker compose build        # builds gateway, memory, data images (root Dockerfile)
docker compose --profile build-only build memory-worker   # worker image launched by memory
docker compose up
curl http://127.0.0.1:8080/healthz
```

Services: `proxy` (Caddy), `gateway`, `memory`, `data`, `postgres` (`pgvector/pgvector:pg17`). Every long-running service drops all capabilities and sets `no-new-privileges`; `proxy`, `gateway` and `data` run with a read-only root filesystem.

`docker compose config` validates the file. `test/infra/compose.test.ts` parses it and asserts the network zones in CI (CI does not start Docker).

## Proxy

`proxy/Caddyfile`: `:8080` locally. `/mcp` goes to `gateway:8080`, `/healthz` is answered by Caddy, everything else is 404. In production, replace `:8080` with the site address for automatic HTTPS. The proxy is the only service with a published port, bound to `127.0.0.1` locally.

## Networks

See the zone table in [architecture.md](architecture.md). `app`, `exec` and `data` are `internal: true`. Consequences:

- Workers have no route to the internet or to `data`/`postgres`. They reach memory's internal tools (`INTERNAL_TOOLS_URL`) and the secrets broker (`BROKER_URL`) and nothing else.
- Postgres is reachable only from `data`.

## Worker containers

Started by `DockerContainerRunner` (`services/memory/src/infrastructure/docker-runner.ts`), one container per execution, input as one JSON document on stdin, output as one JSON document on stdout:

```
docker run --rm -i --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL
  --security-opt no-new-privileges --user 10001:10001 --network agentic-ai_exec
  --memory 512m --pids-limit 128 --env INTERNAL_TOOLS_URL=... --env ANTHROPIC_BASE_URL=... <image>
```

Image (`services/memory/worker/Dockerfile`): Node 26, non-root uid 10001, no login shell, production dependencies only. The only writable path is the `/tmp` tmpfs; the agent runs with `persistSession: false` and no setting sources, so nothing else is written. The container is named after the run (`agentic-worker-<run_id>`). The timeout is enforced by the runner: it kills the docker client, runs `docker rm -f` on the named container and answers `WORKER_TIMEOUT`; turn and budget limits are passed to the agent.

Local limitation: `memory` mounts the Docker socket to launch workers. That is root-equivalent on the host and is acceptable only on a developer machine. Production replaces the adapter (see ADR 4 in [design.md](design.md)).

## Secrets broker

Rule: no secret ever enters a worker container. The worker is given `ANTHROPIC_BASE_URL` pointing at the broker; the broker holds the Anthropic API key, adds it to outgoing requests and enforces an egress allow-list. The broker is **not part of this skeleton**: `compose.yaml` only wires `BROKER_URL`. Until it exists, workers cannot call Anthropic; tests use a scripted agent. Other secrets: `GATEWAY_TOKENS` (local development only, token table adapter) and `POSTGRES_PASSWORD` come from the git-ignored local env file or the platform secret store; only `data` and `postgres` receive the database password.

## Postgres, pgvector and migrations

- Image `pgvector/pgvector:pg17`. The data volume is `postgres-data`.
- `data/migrations/NNNN_name.sql`, applied in order, once each, inside a transaction, recorded in `schema_migrations` (`data/src/infrastructure/migrate.ts`). The `data` service applies pending migrations at start.
  - `0001_runs.sql`: registry of executions (`runs`, `run_events`).
  - `0002_memory.sql`: `CREATE EXTENSION vector`, schema `memory`, table `memory.memories` with `embedding vector(384)` and an HNSW cosine index. The dimension must equal `EMBEDDING_DIMENSION` in `data/src/domain/ports.ts`.
- Never edit an applied migration: add a new numbered file.
- Without `DATABASE_URL`, `data` starts with in-memory repositories (non-persistent, development only).

## CI

`.github/workflows/ci.yml`: `npm ci` then `npm run check` on pull requests and pushes to `main`, with `contents: read`. `claude.yml` and `claude-code-review.yml` are copied from `anthropics/claude-code-action` examples (provenance in the PR that added them); the Claude review reads `CLAUDE.md` and does not run the tests, which is why `ci.yml` exists next to it.
