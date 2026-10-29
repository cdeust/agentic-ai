# Architecture

Four tiers. Each tier has one job and talks only to its neighbour. Decisions and the alternatives we rejected are in [design.md](design.md).

```
                 public            app                          exec            data
client --> [ proxy ] --> [ gateway ] --> [ services/memory ] --> [ worker x N ]
                              |                  |
                              |                  +------------> [ data ] --> [ postgres + pgvector ]
                              |                                    (app + data networks)
                              +-- auth, catalogue, routing, quota, audit (ports)
```

## The four tiers

1. **proxy** (`proxy/Caddyfile`). The only exposed component. Forwards `/mcp` to the gateway and answers `/healthz`. TLS terminates here in production. No logic.
2. **gateway** (`gateway/`). The single MCP server clients see. It lists the tool catalogue, authenticates the caller (port `Authenticator`), applies the quota (port `QuotaPolicy`), routes the call to the service that owns the tool (port `ServiceClient`) and journals it (port `AuditLog`). It runs no agent and touches no data. It forwards the service answer without interpreting it.
3. **services** (`services/memory/`). One micro-service per domain. Its `src/` is a light internal MCP server exposing intent tools (`recall`, `remember`). For each call it validates the input, creates the run (through data), launches the worker through the `ContainerRunner` port, validates the worker output against the tool schema, records the outcome and answers with a `Result`. Its `worker/` is the image that runs the Claude Agent SDK agent with the service's internal tools.
4. **data** (`data/`). The only component that imports `pg`. It exposes typed operations (`runs.create`, `runs.appendEvent`, `runs.complete`, `runs.get`, `runs.events`, `memory.insert`, `memory.search`) over an internal HTTP API, never free-form SQL. Versioned SQL lives in `data/migrations/`.

`packages/contracts` is the only shared package: `Result<T>`, `Run`, `RunEvent`, the zod schemas of every tool and of every data operation, and the worker wire format. It holds no logic.

## Layers inside a component

```
presentation  ->  application  ->  domain  <-  infrastructure
  (MCP/HTTP)      (use cases)     (entities,    (adapters: pg, MCP client,
                                   ports)        Docker, in-memory)
src/main.ts: the composition root, the only place objects are built
```

- `domain` imports only `domain` and `@agentic-ai/contracts`.
- `application` imports `domain`. `infrastructure` imports `domain` and `application`. `presentation` imports `application`.
- Dependencies are injected by constructor. There is no service locator and no global singleton.
- Every port has a real adapter and an in-memory adapter; the in-memory ones make the whole system runnable in a single test process.
- Components never import each other. They call each other over the network.

The rules are enforced by `npm run arch` (`.dependency-cruiser.cjs`) and proved by `test/arch/guard.test.ts`, which writes temporary violating files and checks the guard turns red.

## Network zones

| Zone     | Members                      | Notes                                                                                         |
| -------- | ---------------------------- | --------------------------------------------------------------------------------------------- |
| `public` | proxy                        | The only zone with a published port.                                                          |
| `app`    | proxy, gateway, memory, data | `internal: true`. Service to service traffic.                                                 |
| `exec`   | memory, worker containers    | `internal: true`. Workers reach memory's internal tools and the secrets broker, nothing else. |
| `data`   | data, postgres               | `internal: true`. Workers and the gateway cannot reach the database.                          |

`test/infra/compose.test.ts` checks these memberships against `compose.yaml`.

## Path of a call (`recall`)

1. The client sends MCP `tools/call recall` to the proxy; the proxy forwards `/mcp` to the gateway.
2. Gateway presentation turns the MCP request into the `CallTool` use case with the bearer token. `CallTool`: catalogue lookup, `Authenticator`, `QuotaPolicy`, `ServiceClient.invoke('memory', 'recall', args)`, `AuditLog.record` (also on refusal).
3. Memory presentation (`createMemoryServer`) calls `IntentService.handle('recall', args)`:
   1. validate the input against `RecallInputSchema`; on failure answer `INVALID_INPUT` without creating a run;
   2. `RunRegistry.create` and event `run.created` (data: `runs.create`, `runs.appendEvent`);
   3. event `worker.started`; `ContainerRunner.run` starts the worker with the run id, tool, input and limits on stdin;
   4. event `worker.exited`; parse the worker stdout as `WorkerOutput`, then validate `data` against `RecallDataSchema`;
   5. event `output.validated` or `output.invalid`; `runs.complete`; event `run.completed`;
   6. answer with the `Result`.
4. The worker (`services/memory/worker`) runs the agent with `memory_search` and `memory_insert` as its only tools; these call the memory service's internal endpoint on the `exec` network, which reads and writes through data.
5. The gateway returns the service answer to the client unchanged.

`test/integration/end-to-end.test.ts` runs this whole path in one process: real MCP between client, gateway and memory, an in-process runner executing the real worker core with a scripted agent, and the real data component with in-memory repositories behind its HTTP API.

## The `Result` contract

```ts
type Result<T> = {
  status: 'ok' | 'needs_clarification' | 'failed';
  data: T | null; // null unless status is 'ok'
  evidence: { source: string; ref: string; excerpt?: string }[];
  run_id: string | null; // null only when no run was created (invalid input, data down)
  cost: { input_tokens: number; output_tokens: number; usd: number };
  error?: { code: ErrorCode; message: string }; // present when status is not 'ok'
};
```

- `ok`: `data` validated against the tool's data schema; no `error`.
- `failed`: `error.code` names the cause: `INVALID_INPUT`, `WORKER_UNAVAILABLE`, `WORKER_FAILED`, `WORKER_TIMEOUT`, `WORKER_OUTPUT_INVALID`, `DATA_UNAVAILABLE`, `INTERNAL`.
- `needs_clarification`: the agent needs more input; `error.message` carries the question and `error.code` is `NEEDS_CLARIFICATION`.
- Schemas: `resultSchema(dataSchema)` in `packages/contracts/src/result.ts` declares these invariants.
- Transport-level problems at the gateway (unknown tool, unauthorized, quota, service unavailable) are MCP tool errors with a JSON body `{ code, message }`, because no run exists yet.
