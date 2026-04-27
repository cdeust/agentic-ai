# TypeScript Adapter Contract — `RustPipelineAdapter`

Target file: `packages/codebase/src/adapters/rust-pipeline-adapter.ts`
Port interface: `packages/core/src/ports/codebase-port.ts`

This document is the behavioral specification for Phase 3 implementation.
Every section must be satisfied before any TS file is written.

---

## 1. Liskov Substitutability Statement

The behavioral contract is: any code that works correctly when given a
`CodebasePort` object must work identically when that object is replaced
with a `RustPipelineAdapter` instance, an `InMemoryCodebaseAdapter` test
double, or any future native-TS reimplementation.

This means:

- **Preconditions** of each method may be WEAKENED by a subtype (accept more)
  but never strengthened (reject what the port accepts). The adapter MUST NOT
  add path-validation rules beyond what the Rust binary enforces.
- **Postconditions** may be STRENGTHENED by a subtype (promise more) but never
  weakened (return less). The adapter MUST NOT omit fields the Rust binary returns.
- **Invariants** must be preserved. The adapter's internal subprocess state must
  not leak into the return values (callers must not observe subprocess crash
  recovery as a behavioral difference).
- **History constraint**: the sequence of observable responses must be consistent
  with single-subprocess serial execution. Callers must not be able to distinguish
  whether two calls ran in the same or different subprocess invocations, provided
  the second call follows a successful spawn.

Source: Liskov & Wing 1994, §3–§4.

---

## 2. Port Interface Definition

File: `packages/core/src/ports/codebase-port.ts`

```typescript
// packages/core/src/ports/codebase-port.ts
//
// CodebasePort — the behavioral contract every codebase adapter must satisfy.
// Source: src/tool_schemas.rs + src/main.rs in the ai-architect-mcp Rust crate.
// This file is pure types: no imports from infrastructure, no I/O.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitive schemas
// ---------------------------------------------------------------------------

export const AbsolutePathSchema = z.string().min(1);
export const SafeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine((s) => !s.startsWith("."), { message: "must not start with '.'" })
  .refine((s) => !s.includes(".."), { message: "must not contain '..'" });

// ---------------------------------------------------------------------------
// health_check
// ---------------------------------------------------------------------------

export const HealthCheckInputSchema = z.object({}).strict();
export type HealthCheckInput = z.infer<typeof HealthCheckInputSchema>;

export const HealthCheckOutputSchema = z.object({
  stage: z.literal(0),
  name: z.literal("health_check"),
  status: z.literal("ok"),
  server: z.string(),
  version: z.string(),
  protocol: z.string(),
  stages_registered: z.number().int(),
  tools_count: z.number().int(),
});
export type HealthCheckOutput = z.infer<typeof HealthCheckOutputSchema>;

// ---------------------------------------------------------------------------
// extract_finding
// ---------------------------------------------------------------------------

export const ExtractFindingInputSchema = z.object({
  finding: z.union([z.object({}).passthrough(), z.string()]),
  output_dir: AbsolutePathSchema,
  run_id: SafeIdSchema.optional(),
});
export type ExtractFindingInput = z.infer<typeof ExtractFindingInputSchema>;

export const ExtractFindingOutputSchema = z.object({
  stage: z.literal(1),
  status: z.literal("ok"),
  finding_id: z.string(),
  artifact_path: z.string(),
  run_id: z.string(),
  bytes_written: z.number().int(),
  extractor_version: z.string(),
});
export type ExtractFindingOutput = z.infer<typeof ExtractFindingOutputSchema>;

// ---------------------------------------------------------------------------
// refine_finding
// ---------------------------------------------------------------------------

export const AddedContextSchema = z.object({
  kind: z.string(),
  content: z.string(),
  provenance: z.string().optional(),
});

export const RefinedPromptSchema = z.object({
  text: z.string().min(1),
  role_hint: z.string(),
  token_estimate: z.union([z.number().int(), z.null()]).optional(),
});

export const RefinementSchema = z.object({
  added_context: z.array(AddedContextSchema),
  orchestrator_version: z.string(),
});

export const RefineFindingInputSchema = z.object({
  run_id: SafeIdSchema,
  finding_id: SafeIdSchema,
  output_dir: AbsolutePathSchema,
  refined_prompt: RefinedPromptSchema,
  refinement: RefinementSchema,
});
export type RefineFindingInput = z.infer<typeof RefineFindingInputSchema>;

export const RefineFindingOutputSchema = z.object({
  stage: z.literal(1),
  status: z.literal("ok"),
  finding_id: z.string(),
  artifact_path: z.string(),
  run_id: z.string(),
  bytes_written: z.number().int(),
  extractor_version: z.string(),
  orchestrator_version: z.string(),
  orchestrator_contract_version: z.string(),
});
export type RefineFindingOutput = z.infer<typeof RefineFindingOutputSchema>;

// ---------------------------------------------------------------------------
// start_verification / append_clarification / finalize_verification / abort_verification
// (schemas follow the same pattern — abbreviated here for document length)
// ---------------------------------------------------------------------------

export const VerificationBaseInputSchema = z.object({
  run_id: SafeIdSchema,
  finding_id: SafeIdSchema,
  output_dir: AbsolutePathSchema,
});

export const AppendClarificationInputSchema = VerificationBaseInputSchema.extend({
  kind: z.enum(["agent_question", "user_answer"]),
  content: z.string().min(1),
  meta: z.object({}).passthrough().optional(),
});
export type AppendClarificationInput = z.infer<typeof AppendClarificationInputSchema>;

export const AbortVerificationInputSchema = VerificationBaseInputSchema.extend({
  reason: z.string().optional(),
});
export type AbortVerificationInput = z.infer<typeof AbortVerificationInputSchema>;

// ---------------------------------------------------------------------------
// index_codebase / analyze_codebase
// ---------------------------------------------------------------------------

export const LanguageFilterSchema = z
  .enum(["auto", "rust", "python", "typescript"])
  .default("auto");

export const IndexCodebaseInputSchema = z.object({
  path: AbsolutePathSchema,
  output_dir: AbsolutePathSchema,
  language: LanguageFilterSchema.optional(),
});
export type IndexCodebaseInput = z.infer<typeof IndexCodebaseInputSchema>;

export const IndexCodebaseOutputSchema = z.object({
  stage: z.literal(3),
  status: z.literal("ok"),
  tool: z.literal("index_codebase"),
  graph_path: z.string(),
  node_count: z.number().int(),
  edge_count: z.number().int(),
  files_indexed: z.number().int(),
  elapsed_ms: z.number().int(),
});
export type IndexCodebaseOutput = z.infer<typeof IndexCodebaseOutputSchema>;

export const AnalyzeCodebaseInputSchema = z.object({
  path: AbsolutePathSchema,
  output_dir: AbsolutePathSchema,
  language: LanguageFilterSchema.optional(),
  resolution_param: z.number().default(1.0).optional(),
  lsp: z.boolean().default(false).optional(),
});
export type AnalyzeCodebaseInput = z.infer<typeof AnalyzeCodebaseInputSchema>;

// ---------------------------------------------------------------------------
// query_graph
// ---------------------------------------------------------------------------

export const QueryGraphInputSchema = z.object({
  graph_path: AbsolutePathSchema,
  query: z.string().min(1),
});
export type QueryGraphInput = z.infer<typeof QueryGraphInputSchema>;

export const QueryGraphOutputSchema = z.object({
  stage: z.literal(3),
  status: z.literal("ok"),
  tool: z.literal("query_graph"),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  result: z.string(),           // pre-formatted pipe-delimited string (Finding F-002)
  elapsed_ms: z.number().int(),
});
export type QueryGraphOutput = z.infer<typeof QueryGraphOutputSchema>;

// ---------------------------------------------------------------------------
// search_codebase
// ---------------------------------------------------------------------------

export const SearchCodebaseInputSchema = z.object({
  graph_path: AbsolutePathSchema,
  query: z.string(),
  limit: z.number().int().default(20).optional(),
  label_filter: z
    .enum(["Function", "Method", "Struct", "Enum", "Trait", "Module", "Constant", "TypeAlias"])
    .optional(),
});
export type SearchCodebaseInput = z.infer<typeof SearchCodebaseInputSchema>;

// ---------------------------------------------------------------------------
// detect_changes
// ---------------------------------------------------------------------------

export const DetectChangesInputSchema = z
  .object({
    graph_path: AbsolutePathSchema,
    diff_text: z.string().optional(),
    codebase_path: AbsolutePathSchema.optional(),
    base_ref: z.string().default("HEAD~1").optional(),
    head_ref: z.string().default("HEAD").optional(),
  })
  .refine(
    (v) => v.diff_text !== undefined || v.codebase_path !== undefined,
    { message: "either diff_text or codebase_path must be provided" }
  );
export type DetectChangesInput = z.infer<typeof DetectChangesInputSchema>;

// ---------------------------------------------------------------------------
// lsp_resolve
// ---------------------------------------------------------------------------

export const LspResolveInputSchema = z.object({
  graph_path: AbsolutePathSchema,
  codebase_path: AbsolutePathSchema,
  language: z.enum(["rust", "python", "typescript", "auto"]).default("auto").optional(),
  lsp_command: z.string().optional(),
  timeout_ms: z.number().int().default(30000).optional(),
});
export type LspResolveInput = z.infer<typeof LspResolveInputSchema>;

// ---------------------------------------------------------------------------
// verify_semantic_diff
// ---------------------------------------------------------------------------

export const VerifySemanticDiffInputSchema = z.object({
  before_graph_path: AbsolutePathSchema,
  after_graph_path: AbsolutePathSchema,
  report_path: AbsolutePathSchema.optional(),
});
export type VerifySemanticDiffInput = z.infer<typeof VerifySemanticDiffInputSchema>;

// ---------------------------------------------------------------------------
// check_security_gates
// ---------------------------------------------------------------------------

export const CheckSecurityGatesInputSchema = z.object({
  graph_path: AbsolutePathSchema,
  changed_symbols: z.array(z.string()),
  // All-or-nothing triple — ADR-004: artifact written only when all three present
  output_dir: AbsolutePathSchema.optional(),
  run_id: SafeIdSchema.optional(),
  finding_id: SafeIdSchema.optional(),
});
export type CheckSecurityGatesInput = z.infer<typeof CheckSecurityGatesInputSchema>;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

// All MCP tool errors have this shape.
export const McpToolErrorSchema = z.object({
  stage: z.number().int(),
  status: z.literal("error"),
  reason: z.string(),
  message: z.string().optional(),
  // lsp_resolve only — preserved exactly per Finding F-001
  allowed: z.array(z.string()).optional(),
  // get_symbol / get_context only
  did_you_mean: z.array(z.string()).optional(),
});
export type McpToolError = z.infer<typeof McpToolErrorSchema>;

export class McpToolCallError extends Error {
  constructor(
    public readonly toolError: McpToolError,
    public readonly toolName: string
  ) {
    super(`${toolName} failed [${toolError.reason}]: ${toolError.message ?? ""}`);
    this.name = "McpToolCallError";
  }
}

// Adapter-layer errors (not from the Rust binary)
export class SubprocessError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "SubprocessError";
  }
}

export class SubprocessRestartedError extends Error {
  constructor(public readonly restartCount: number) {
    super(`Rust subprocess restarted (count: ${restartCount})`);
    this.name = "SubprocessRestartedError";
  }
}

// ---------------------------------------------------------------------------
// The Port interface
// ---------------------------------------------------------------------------

export interface CodebasePort {
  // Stage 0
  healthCheck(input: HealthCheckInput): Promise<HealthCheckOutput>;

  // Stage 1 — finding pipeline
  extractFinding(input: ExtractFindingInput): Promise<ExtractFindingOutput>;
  refineFinding(input: RefineFindingInput): Promise<RefineFindingOutput>;

  // Stage 2 — verification
  startVerification(input: z.infer<typeof VerificationBaseInputSchema>): Promise<unknown>;
  appendClarification(input: AppendClarificationInput): Promise<unknown>;
  finalizeVerification(input: z.infer<typeof VerificationBaseInputSchema>): Promise<unknown>;
  abortVerification(input: AbortVerificationInput): Promise<unknown>;

  // Stage 3 — codebase intelligence
  indexCodebase(input: IndexCodebaseInput): Promise<IndexCodebaseOutput>;
  queryGraph(input: QueryGraphInput): Promise<QueryGraphOutput>;
  getSymbol(input: z.infer<typeof z.object({ graph_path: typeof AbsolutePathSchema, qualified_name: z.ZodString }))>): Promise<unknown>;
  resolveGraph(input: { graph_path: string }): Promise<unknown>;
  clusterGraph(input: { graph_path: string; resolution_param?: number }): Promise<unknown>;
  getProcesses(input: { graph_path: string }): Promise<unknown>;
  getImpact(input: { graph_path: string; qualified_name: string }): Promise<unknown>;
  searchCodebase(input: SearchCodebaseInput): Promise<unknown>;
  getContext(input: { graph_path: string; qualified_name: string }): Promise<unknown>;
  analyzeCodebase(input: AnalyzeCodebaseInput): Promise<unknown>;
  detectChanges(input: DetectChangesInput): Promise<unknown>;
  lspResolve(input: LspResolveInput): Promise<unknown>;

  // Stage 4 — PRD input
  preparePrdInput(input: {
    run_id: string;
    finding_id: string;
    output_dir: string;
    graph_path: string;
  }): Promise<unknown>;

  // Stage 6 — PRD validation
  validatePrdAgainstGraph(input: {
    prd_path: string;
    graph_path: string;
    affected_symbols_path?: string;
    output_dir?: string;
    run_id?: string;
    finding_id?: string;
  }): Promise<unknown>;

  // Stage 8 — security gates
  checkSecurityGates(input: CheckSecurityGatesInput): Promise<unknown>;

  // Stage 9 — semantic diff
  verifySemanticDiff(input: VerifySemanticDiffInput): Promise<unknown>;

  // Lifecycle
  dispose(): Promise<void>;
}
```

**Note on `unknown` return types**: The full Zod schemas for every output are specified
in `MCP_TOOLS.md`. The `unknown` markers above are placeholders that the Phase 3
implementer must replace with fully-typed Zod schemas before shipping. The port
interface is structural — callers will use the concrete types, not `unknown`.

---

## 3. Subprocess Lifecycle

### 3.1 Spawn Strategy

The adapter spawns the Rust binary as a child process on the **first call**
(lazy initialization). This avoids startup cost if the adapter is instantiated
but never used (e.g. during DI container construction).

```typescript
// Sketch — not a complete implementation
class RustPipelineAdapter implements CodebasePort {
  private proc: ChildProcess | null = null;
  private pendingRequests = new Map<string|number, PendingRequest>();
  private callQueue: Array<() => void> = [];
  private callInFlight = false;
  private nextId = 0;
  private restartCount = 0;

  private async ensureStarted(): Promise<void> {
    if (this.proc !== null) return;
    this.proc = spawnSync(this.config.binaryPath, [], {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env },
    });
    this.wireStdout();
    await this.sendInitialize();
  }
}
```

The binary path is injected via `AdapterConfig.binaryPath`. Default: resolved
via `which ai-architect-mcp` at construction time with a hard failure if not found.

### 3.2 MCP Handshake

On spawn, the adapter sends `initialize` and waits for the response before
unblocking the first call. This confirms the binary is live and speaking MCP.

```typescript
// source: src/main.rs handle_request — initialize returns protocolVersion,
// capabilities, serverInfo. We verify protocolVersion matches "2024-11-05".
private async sendInitialize(): Promise<void> {
  const result = await this.sendRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "rust-pipeline-adapter", version: "1.0.0" },
  });
  await this.sendNotification("notifications/initialized", {});
  // postcondition: result.protocolVersion === "2024-11-05"
}
```

### 3.3 JSON-RPC Framing

The Rust binary reads and writes newline-delimited JSON
(source: `src/main.rs` stdio loop — `BufRead` line reader, `writeln!` + `flush` on write).

- Each request is one line: `JSON.stringify(req) + "\n"`
- Each response is one line: parsed with `JSON.parse`
- `id` values are monotonically increasing integers (adapter-owned)
- The adapter sets `"jsonrpc": "2.0"` on all requests

```typescript
private sendRequest(method: string, params: unknown): Promise<unknown> {
  const id = ++this.nextId;
  const line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  return new Promise((resolve, reject) => {
    this.pendingRequests.set(id, { resolve, reject });
    this.proc!.stdin!.write(line);
  });
}
```

### 3.4 Serialized Call Queue

**Single-flight invariant**: only one JSON-RPC request is in flight at a time.
This is correct because:
1. The Rust binary is single-threaded (no async runtime, single stdio loop).
2. Parallel in-flight requests would require response demultiplexing by `id` —
   while structurally possible, the Rust binary makes no performance guarantees
   under concurrent load, and several tools mutate on-disk state (stage-1, 2)
   whose correctness depends on serial ordering.

```typescript
private async callTool(name: string, args: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    this.callQueue.push(async () => {
      try {
        const result = await this.sendRequest("tools/call", { name, arguments: args });
        resolve(result);
      } catch (e) {
        reject(e);
      } finally {
        this.callInFlight = false;
        this.drainQueue();
      }
    });
    this.drainQueue();
  });
}

private drainQueue(): void {
  if (this.callInFlight || this.callQueue.length === 0) return;
  this.callInFlight = true;
  this.callQueue.shift()!();
}
```

**Justification for serial vs parallel**: the Rust binary's `std::env::set_var`
side effect in `search_codebase` (source: `src/main.rs:2382`) is a global mutation.
Parallel calls to `search_codebase` from different logical requests would race on
`AA_SEARCH_INDEX_DIR`. Serial execution eliminates this race.

### 3.5 Response Parsing

Every `tools/call` response from the Rust binary wraps the payload in a content envelope:
```json
{ "content": [{ "type": "text", "text": "<JSON string>" }] }
```
The adapter unwraps this envelope before returning to callers:

```typescript
private unwrapContent(result: unknown): unknown {
  // source: src/main.rs:3316-3321 — handle_tool_call wraps payload in content/text
  const content = (result as any)?.content?.[0]?.text;
  if (typeof content !== "string") {
    throw new SubprocessError("unexpected response shape — missing content[0].text");
  }
  return JSON.parse(content);
}
```

Error payloads (status: "error") are NOT thrown as exceptions by default.
They are returned as-is so callers can branch on `reason` codes.
The adapter throws `McpToolCallError` ONLY for transport-level failures
(subprocess dead, JSON parse failure, framing error).

### 3.6 Health Check + Restart Policy

If the subprocess exits unexpectedly (stdout closes before `dispose()` is called):

1. The adapter sets `this.proc = null`.
2. All pending requests in the queue are rejected with `SubprocessError`.
3. On the next call, `ensureStarted()` re-spawns, increments `restartCount`,
   and emits a `SubprocessRestartedError` notification (observable via an `onRestart` callback).

```typescript
export interface AdapterConfig {
  binaryPath: string;
  onRestart?: (restartCount: number) => void;
  maxRestarts?: number;          // default: 3; after this, all calls throw SubprocessError
  healthCheckIntervalMs?: number; // default: undefined (no periodic health check)
}
```

If `maxRestarts` is exceeded, all subsequent calls throw `SubprocessError` without
attempting to restart. The adapter is considered failed and must be replaced.

**Periodic health check**: when `healthCheckIntervalMs` is set, the adapter queues
a `health_check` call at the given interval. This detects silent subprocess death
(process alive but not responding) before a real call blocks.

### 3.7 Graceful Shutdown

```typescript
async dispose(): Promise<void> {
  if (this.proc === null) return;
  // Drain the queue: wait for in-flight call to complete
  await new Promise<void>((resolve) => {
    if (!this.callInFlight) { resolve(); return; }
    const orig = this.callQueue;
    this.callQueue = [...orig, () => { resolve(); }];
  });
  // Close stdin — Rust binary's BufRead loop exits on EOF
  this.proc.stdin?.end();
  // Give the process up to 2 seconds to exit cleanly
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => { this.proc?.kill("SIGTERM"); resolve(); }, 2000);
    this.proc!.once("exit", () => { clearTimeout(t); resolve(); });
  });
  this.proc = null;
}
```

The Rust binary exits cleanly on stdin EOF (source: `src/main.rs` stdio loop
uses `stdin().lock().lines()` — the iterator ends on EOF).

---

## 4. Error Model

### 4.1 Error Taxonomy

```
SubprocessError          — transport layer (spawn failed, binary crashed, framing error)
SubprocessRestartedError — informational; subprocess was restarted
McpToolCallError         — Rust binary returned { status: "error" }
  .toolError.reason      — machine-readable code (MUST be passed through verbatim)
  .toolError.message     — human-readable message
  .toolError.allowed     — present only for lsp_command_not_allowed (Finding F-001)
  .toolError.did_you_mean — present for symbol_not_found
```

### 4.2 What the Adapter Throws vs Returns

The adapter **throws** `SubprocessError` for:
- Binary not found at `binaryPath`
- `spawn()` fails
- Subprocess exits before responding
- Response is not valid JSON
- Response is missing `content[0].text`

The adapter **throws** `McpToolCallError` for:
- `tools/call` returns `{ "isError": true }` (unknown tool name — should never happen
  if the binary and adapter are in sync)

The adapter **returns** the error payload as-is (does NOT throw) for:
- `{ "status": "error", "reason": "..." }` payloads — callers branch on `reason`

**Critical invariant (Finding F-001)**: `lsp_resolve` error reason codes
(`lsp_command_not_allowed`, `lsp_not_found`, `lsp_probe_failed`, `lsp_resolve_failed`)
and the `allowed` array on `lsp_command_not_allowed` MUST be forwarded exactly.
The adapter must NEVER map these to a generic `McpToolCallError` or strip the `allowed` field.

**Critical invariant (Finding F-004)**: `get_symbol` returns `{ node: null }` in the
success path when a symbol is not found. The adapter must not convert a null `node` into a thrown error.

### 4.3 Schema Validation

The adapter validates:
- **Inputs** at the TS layer (before sending to the subprocess) using Zod schemas
  defined in `codebase-port.ts`. Input validation failure throws `z.ZodError`.
- **Outputs** are NOT validated at the adapter layer (the Rust binary is the source of
  truth; output validation is done by callers via the typed output schemas).

This keeps the adapter lean and avoids double-validation overhead on the hot path.

---

## 5. Concurrency Model

### 5.1 Summary

| Property | Value |
|---|---|
| Subprocess count per host process | 1 |
| Calls serialized per adapter instance | Yes (single in-flight queue) |
| Multiple adapter instances per process | Allowed (each gets its own subprocess) |
| Thread safety | Adapter is NOT thread-safe; wrap with a mutex if shared across threads |

### 5.2 Rationale for Serial Queue

- The Rust binary is single-threaded (no async; no rayon; stdio loop).
- Several tools write to shared on-disk state: stage-1/stage-2 artifacts, `index.json`.
  Concurrent calls from the same adapter instance would create a race on the disk state
  that the Rust binary's `atomic_write` does not protect against (it protects against
  concurrent OS processes, not concurrent calls within one process).
- `search_codebase` sets a global env var (`AA_SEARCH_INDEX_DIR`) — a process-global
  side effect that is unsafe to interleave.
- The Rust binary's response latency is dominated by I/O and graph traversal, not
  by CPU. Serialization adds minimal latency overhead while eliminating a class of
  race conditions.

**If parallel calls are needed in future** (ADR-002): add a pool of adapter instances
with a round-robin dispatcher. Each instance has its own subprocess. Do not add
parallel in-flight requests to a single subprocess instance.

---

## 6. Adapter Sketch

```typescript
// packages/codebase/src/adapters/rust-pipeline-adapter.ts
//
// SKETCH ONLY — types marked 'unknown' must be replaced with Zod schemas
// from codebase-port.ts before Phase 3 implementation is considered complete.

import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import {
  CodebasePort,
  AdapterConfig,
  McpToolCallError,
  McpToolError,
  McpToolErrorSchema,
  SubprocessError,
  SubprocessRestartedError,
  HealthCheckInput,
  HealthCheckOutput,
  HealthCheckOutputSchema,
  ExtractFindingInput,
  ExtractFindingOutput,
  ExtractFindingOutputSchema,
  // ... all other input/output types
} from "../../../core/src/ports/codebase-port";

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export class RustPipelineAdapter implements CodebasePort {
  private proc: ChildProcess | null = null;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly callQueue: Array<() => Promise<void>> = [];
  private callInFlight = false;
  private nextId = 0;
  private restartCount = 0;
  private disposed = false;

  constructor(private readonly config: AdapterConfig) {}

  // --- CodebasePort implementation ---

  async healthCheck(_input: HealthCheckInput): Promise<HealthCheckOutput> {
    const raw = await this.callTool("health_check", {});
    return HealthCheckOutputSchema.parse(raw);
  }

  async extractFinding(input: ExtractFindingInput): Promise<ExtractFindingOutput> {
    const raw = await this.callTool("extract_finding", input);
    return ExtractFindingOutputSchema.parse(raw);
  }

  // ... (one method per tool; pattern is identical to the two above)

  async queryGraph(input: QueryGraphInput): Promise<QueryGraphOutput> {
    // postcondition: result contains columns, rows, AND result string (Finding F-002)
    const raw = await this.callTool("query_graph", input);
    return QueryGraphOutputSchema.parse(raw);
  }

  async lspResolve(input: LspResolveInput): Promise<unknown> {
    // IMPORTANT: error reason codes are passed through verbatim (Finding F-001)
    // This method returns the raw payload on error (not throws)
    return this.callTool("lsp_resolve", input);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    // drain + close (see lifecycle §3.7)
    if (this.proc === null) return;
    this.proc.stdin?.end();
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { this.proc?.kill("SIGTERM"); resolve(); }, 2000);
      this.proc!.once("exit", () => { clearTimeout(t); resolve(); });
    });
    this.proc = null;
  }

  // --- Private machinery ---

  private async ensureStarted(): Promise<void> {
    if (this.proc !== null) return;
    if (this.disposed) throw new SubprocessError("adapter is disposed");
    if (this.restartCount > (this.config.maxRestarts ?? 3)) {
      throw new SubprocessError(`max restarts exceeded (${this.restartCount})`);
    }

    this.proc = spawn(this.config.binaryPath, [], {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env },
    });

    this.proc.stdout!.setEncoding("utf-8");
    const rl = createInterface({ input: this.proc.stdout! });
    rl.on("line", (line) => this.onLine(line));

    this.proc.on("exit", () => {
      this.proc = null;
      // Reject all pending requests
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new SubprocessError("subprocess exited unexpectedly"));
      }
      this.pendingRequests.clear();
      this.callInFlight = false;
      if (!this.disposed) {
        this.restartCount++;
        this.config.onRestart?.(this.restartCount);
      }
    });

    await this.performHandshake();
  }

  private async performHandshake(): Promise<void> {
    // source: src/main.rs handle_request — initialize handler
    const result = await this.sendRaw("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "rust-pipeline-adapter", version: "1.0.0" },
    });
    await this.sendRaw("notifications/initialized", {});
    const proto = (result as any)?.protocolVersion;
    if (proto !== "2024-11-05") {
      throw new SubprocessError(
        `unexpected protocol version: ${proto} (expected 2024-11-05)`
      );
    }
  }

  private onLine(line: string): void {
    let msg: any;
    try { msg = JSON.parse(line); } catch {
      // Malformed line — reject the in-flight request
      const id = msg?.id;
      const pending = id !== undefined ? this.pendingRequests.get(id) : undefined;
      if (pending) pending.reject(new SubprocessError(`malformed JSON from subprocess: ${line}`));
      return;
    }
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;
    this.pendingRequests.delete(msg.id);
    if (msg.error) {
      pending.reject(new SubprocessError(msg.error.message ?? "JSON-RPC error"));
    } else {
      pending.resolve(msg.result);
    }
  }

  private sendRaw(method: string, params: unknown): Promise<unknown> {
    const id = ++this.nextId;
    const line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.proc!.stdin!.write(line, (err) => {
        if (err) {
          this.pendingRequests.delete(id);
          reject(new SubprocessError(`write to subprocess failed: ${err.message}`));
        }
      });
    });
  }

  private async callTool(name: string, args: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const task = async () => {
        try {
          await this.ensureStarted();
          const result = await this.sendRaw("tools/call", { name, arguments: args });
          // Unwrap content envelope (source: src/main.rs:3316-3321)
          const text = (result as any)?.content?.[0]?.text;
          if (typeof text !== "string") {
            // isError path (unknown tool name)
            if ((result as any)?.isError === true) {
              throw new McpToolCallError(
                { stage: 0, status: "error", reason: "unknown_tool",
                  message: (result as any)?.content?.[0]?.text },
                name
              );
            }
            throw new SubprocessError(`unexpected response shape from tool ${name}`);
          }
          resolve(JSON.parse(text));
        } catch (e) {
          reject(e);
        } finally {
          this.callInFlight = false;
          this.drainQueue();
        }
      };
      this.callQueue.push(task);
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    if (this.callInFlight || this.callQueue.length === 0) return;
    this.callInFlight = true;
    this.callQueue.shift()!();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRustPipelineAdapter(config: AdapterConfig): CodebasePort {
  return new RustPipelineAdapter(config);
}
```

---

## 7. In-Memory Test Double

An `InMemoryCodebaseAdapter` must pass the same contract test suite as
`RustPipelineAdapter`. It is the canonical test double for callers of `CodebasePort`.

```typescript
// packages/codebase/src/adapters/in-memory-codebase-adapter.ts
// (sketch — not a production implementation)

export class InMemoryCodebaseAdapter implements CodebasePort {
  private health = { server: "test", version: "0.0.0", protocol: "2024-11-05" };

  async healthCheck(_: HealthCheckInput): Promise<HealthCheckOutput> {
    return {
      stage: 0, name: "health_check", status: "ok",
      ...this.health, stages_registered: 23, tools_count: 23,
    };
  }

  // All other methods return minimal valid responses.
  // The contract test suite verifies that InMemoryCodebaseAdapter
  // is substitutable for RustPipelineAdapter on all 10 parity probes.

  async dispose(): Promise<void> { /* no-op */ }
}
```

**Substitutability requirement**: for every probe in `PARITY_PROBES.md`,
`InMemoryCodebaseAdapter.methodX(input)` must return an object whose key set
matches the key set returned by `RustPipelineAdapter.methodX(input)`.
The parity oracle masks timestamps, paths, and digest values before comparing.

---

## 8. Open ADRs (decisions required before Phase 3 implementation)

See `MISSION.md §7` for full ADR descriptions. Summary:

| ADR | Question | Blocks |
|---|---|---|
| ADR-001 | Signal propagation through three-process chain (TS → Rust → LSP) | `lspResolve` |
| ADR-002 | Accept blocking on `analyzeCodebase` or add streaming progress channel | `analyzeCodebase` |
| ADR-003 | Confirm adapter adds zero path restrictions beyond Rust binary's `validate_graph_path_safe` | All graph tools |
| ADR-004 | Confirm TS type for optional-triple (`run_id + finding_id + output_dir`) is all-or-nothing | `validatePrdAgainstGraph`, `checkSecurityGates` |
