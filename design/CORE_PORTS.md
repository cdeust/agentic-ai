# Core Ports — `@agentic/core`

> Ports (interfaces) declare cross-package boundaries. Every adapter in the
> monorepo implements exactly one Port. No implementation code lives here —
> only contracts.
>
> Liskov principle: every implementation of a Port must be substitutable for
> every other implementation of the same Port. No postcondition may be weakened
> by an adapter. No precondition may be strengthened.
>
> The four Ports below correspond to the four source-repo seams identified in
> the type inventory:
>   - MemoryPort   — Cortex MCP server
>   - CodebasePort — ai-automatised-pipeline MCP server
>   - ReasoningPort — zetetic-team-subagents (Agent tool)
>   - PRDPort       — prd-spec-generator MCP server

---

## Port 1 — MemoryPort

Source seam: Cortex `mcp_server/tool_registry_memory.py` tools `recall` + `remember`.

```ts
// src/ports/memory-port.ts
import type {
  RecallRequest,
  RecallResponse,
  RememberRequest,
  RememberResponse,
} from "../domain/memory/index.js";

/**
 * MemoryPort — the boundary between the agentic monorepo and Cortex's
 * memory subsystem.
 *
 * Contract invariants (Liskov):
 *   recall:
 *     - Pre: request.query is non-empty string.
 *     - Post: returned RecallResponse.items is ordered by descending score.
 *     - Post: every item.id in the response was previously stored via remember.
 *     - Post: empty result set (items: []) is valid; never throws on "not found".
 *
 *   remember:
 *     - Pre: request.content is non-empty string.
 *     - Post: if response.stored === true, a subsequent recall with the same
 *       content as query MUST return at least one item whose content contains
 *       the stored text (subject to min_heat threshold and domain filter).
 *     - Post: if response.stored === false, response.reason is non-null.
 *
 * Adapters: CortexMcpMemoryAdapter (packages/memory), StubMemoryAdapter (tests).
 */
export interface MemoryPort {
  recall(request: RecallRequest): Promise<RecallResponse>;
  remember(request: RememberRequest): Promise<RememberResponse>;
}
```

**Decomposition note**: Two operations, not one, because the read-path (recall)
and write-path (remember) have different caching, rate-limiting, and
authorization implications. Splitting them allows adapters to implement
read-only ports for test environments.

---

## Port 2 — CodebasePort

Source seam: ai-automatised-pipeline `src/tool_schemas.rs` — the full codebase
analysis + graph query surface.

The port exposes only the five operations that are called across package
boundaries in the monorepo. Low-level operations (resolve_graph, cluster_graph,
lsp_resolve) are implementation details of the Rust MCP server and do not
appear at the port boundary.

```ts
// src/ports/codebase-port.ts
import type {
  IndexCodebaseInput,
  AnalyzeCodebaseInput,
  QueryGraphInput,
  SearchCodebaseInput,
  GetSymbolInput,
  DetectChangesInput,
} from "../domain/codebase/index.js";

// Result types — defined here because they have no direct precedent in the
// Rust tool_schemas.rs (which only defines inputSchemas, not outputSchemas).
// The shapes below are inferred from the tool descriptions in tool_schemas.rs.

export interface GraphStats {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly elapsedMs: number;
  readonly graphPath: string;
}

export interface SymbolResult {
  readonly qualifiedName: string;
  readonly kind: string;
  readonly filePath: string;
  readonly community: number | null;
  readonly processes: readonly string[];
  readonly relevanceScore: number;
}

export interface ChangeImpact {
  readonly changedSymbols: readonly string[];
  readonly affectedCommunities: readonly number[];
  readonly affectedProcesses: readonly string[];
  readonly riskScore: number;
}

/**
 * CodebasePort — boundary between the monorepo and the ai-automatised-pipeline
 * Rust MCP server.
 *
 * Contract invariants (Liskov):
 *   indexCodebase / analyzeCodebase:
 *     - Pre: input.path must be an absolute path to an existing directory.
 *     - Post: returned graphPath is a valid absolute path to a readable directory.
 *     - Post: nodeCount >= 0, edgeCount >= 0.
 *     - Post: a subsequent queryGraph(graphPath, ...) MUST succeed without error.
 *
 *   queryGraph:
 *     - Pre: input.graphPath must be the path returned by a prior indexCodebase
 *       or analyzeCodebase call.
 *     - Post: returns rows as JSON array (empty array is valid, not an error).
 *
 *   searchCodebase:
 *     - Pre: input.query is non-empty.
 *     - Post: results ordered by descending relevanceScore.
 *     - Post: empty result set is valid.
 *
 *   detectChanges:
 *     - Pre: exactly one of (diffText) or (codebasePath + refs) must be supplied.
 *     - Post: every qualifiedName in changedSymbols exists in the indexed graph.
 *     - Post: riskScore is in [0.0, 1.0].
 *
 * Adapters: AutomatisedPipelineMcpAdapter (packages/codebase), StubCodebaseAdapter (tests).
 */
export interface CodebasePort {
  indexCodebase(input: IndexCodebaseInput): Promise<GraphStats>;
  analyzeCodebase(input: AnalyzeCodebaseInput): Promise<GraphStats>;
  queryGraph(input: QueryGraphInput): Promise<readonly unknown[]>;
  searchCodebase(input: SearchCodebaseInput): Promise<readonly SymbolResult[]>;
  getSymbol(input: GetSymbolInput): Promise<SymbolResult | null>;
  detectChanges(input: DetectChangesInput): Promise<ChangeImpact>;
}
```

**Decomposition note**: `queryGraph` returns `readonly unknown[]` because the
Cypher query result schema is open — the caller knows the shape from its own
query. Wrapping in `z.unknown()` at the adapter boundary is correct here:
the port cannot be more specific without knowing the query.

---

## Port 3 — ReasoningPort

Source seam: zetetic-team-subagents (Agent tool dispatch) + prd-spec-generator
`JudgeRequest` / `JudgeVerdict`.

Two distinct operations: `judge` (structured claim evaluation) and `invoke`
(free-form agent task). They are kept on the same port because both share the
`AgentIdentity` contract and the same adapter (the Agent tool dispatcher).

```ts
// src/ports/reasoning-port.ts
import type {
  AgentIdentity,
  SubagentInvocation,
  SubagentResponse,
} from "../domain/reasoning/index.js";
import type { JudgeRequest, JudgeVerdict } from "../domain/prd/index.js";

/**
 * ReasoningPort — boundary between the monorepo and the zetetic-team-subagents
 * Agent tool.
 *
 * Contract invariants (Liskov):
 *   judge:
 *     - Pre: request.judge is a valid AgentIdentity.
 *     - Pre: request.claim.claim_id is non-empty.
 *     - Post: response.judge === request.judge (identity preserved).
 *     - Post: response.claim_id === request.claim.claim_id.
 *     - Post: response.verdict is one of the 5 VerdictSchema members.
 *     - Post: response.confidence is in [0, 1].
 *     - Post: response.rationale is non-empty string.
 *
 *   invoke:
 *     - Pre: invocation.prompt is non-empty.
 *     - Post: response.agent === invocation.agent.
 *     - Post: response.text is non-empty string.
 *     - Post: if invocation.expectedFormat === "json", response.text is
 *       parseable as JSON (adapter responsibility to enforce).
 *
 * Adapters: ZeteticAgentToolAdapter (packages/reasoning), StubReasoningAdapter (tests).
 */
export interface ReasoningPort {
  judge(request: JudgeRequest): Promise<JudgeVerdict>;
  invoke(invocation: SubagentInvocation): Promise<SubagentResponse>;
}
```

**Decomposition note**: `judge` vs `invoke` is not a redundancy. `judge` carries
a typed contract: the caller knows the input claim type and expects a
`JudgeVerdict` with structured verdict + confidence. `invoke` is open-ended.
A single `invoke` that accepts JudgeRequest would lose the return type
narrowing — an LSP violation.

---

## Port 4 — PRDPort

Source seam: prd-spec-generator MCP server + ai-automatised-pipeline stage 4
(`prepare_prd_input`) bridging into the PRD pipeline.

```ts
// src/ports/prd-port.ts
import type { PRDDocument } from "../domain/prd/index.js";
import type { PreparePrdInputInput } from "../domain/codebase/index.js";

export interface PRDPipelineInput {
  readonly findingDescription: string;
  readonly context: import("../domain/prd/prd-context.js").PRDContext;
  readonly prdInputPath?: string; // absolute path to stage-4.prd_input.json
}

export interface PRDPipelineResult {
  readonly document: PRDDocument;
  readonly qualityScore: number;
  readonly criticalViolationCount: number;
  readonly elapsedMs: number;
}

export interface ActionResultInput {
  readonly runId: string;
  readonly findingId: string;
  readonly actionType: "approved" | "rejected" | "deferred";
  readonly rationale: string;
}

/**
 * PRDPort — boundary between the monorepo orchestrator and the PRD generation
 * pipeline (prd-spec-generator MCP server) and the Rust pipeline's stage 4
 * bundle step.
 *
 * Contract invariants (Liskov):
 *   preparePrdInput:
 *     - Pre: input.runId and input.findingId correspond to a finalized stage-2 session.
 *     - Pre: input.graphPath must be a valid graph directory.
 *     - Post: writes stage-4.prd_input.json atomically to the output directory.
 *     - Post: returns the absolute path to the written file.
 *
 *   startPipeline:
 *     - Pre: input.findingDescription is non-empty.
 *     - Post: document.id is a valid UUID v4.
 *     - Post: document.sections is non-empty.
 *     - Post: qualityScore is in [0, 1].
 *
 *   submitActionResult:
 *     - Pre: input.runId and input.findingId identify an existing pipeline run.
 *     - Post: the run's state is updated; no error on idempotent re-submission
 *       with the same actionType.
 *
 * Adapters: PrdSpecGeneratorMcpAdapter (packages/prd), StubPrdAdapter (tests).
 */
export interface PRDPort {
  preparePrdInput(input: PreparePrdInputInput): Promise<string>;
  startPipeline(input: PRDPipelineInput): Promise<PRDPipelineResult>;
  submitActionResult(input: ActionResultInput): Promise<void>;
}
```

---

## Seams that do not decompose cleanly into a single Port

### Seam: wiki subsystem (Cortex)

The Cortex wiki subsystem (`wiki_write`, `wiki_read`, `wiki_list`, `wiki_link`,
`wiki_adr`) exposes a document-authoring surface that sits between memory
(it persists structured knowledge) and codebase (its `wiki_link` creates graph
edges between pages). It does not cleanly belong to `MemoryPort` (it is not
episodic/semantic memory recall) or `CodebasePort` (it is not code-graph
querying).

**Decision**: Introduce a `WikiPort` in a follow-up PR (`port/wiki-port`).
The current `MemoryPort` does NOT include wiki operations. `WikiPort` will own:
`writePage`, `readPage`, `listPages`, `linkPages`, `createAdr`. This seam is
noted here so parallel worktrees know not to assume wiki operations are
covered by `MemoryPort`.

Rationale for deferral: the wiki subsystem has no direct consumers in Phase 4
parallel worktrees. Forcing it into `MemoryPort` would weaken the port's
postconditions (recall does not write; a wiki_write through MemoryPort
would violate the read/write separation invariant).

### Seam: prd-validation (ai-automatised-pipeline stages 6 + 8 + 9)

`validate_prd_against_graph`, `check_security_gates`, `verify_semantic_diff`
are invoked as post-generation validation steps. They bridge `CodebasePort`
(they read the graph) and `PRDPort` (they validate PRD content). Neither port
alone is the right owner.

**Decision**: These belong to a `ValidationPort` (out of scope for Phase 0).
They are typed in `CORE_TYPESPACE.md` (the input types exist) but not yet
wired to a Port. The `PRDPort.startPipeline` post-condition deliberately
omits them — they are optional validation stages, not invariants.

---

## Port dependency diagram

```
  MemoryPort        CodebasePort      ReasoningPort     PRDPort
       |                  |                 |               |
   packages/         packages/          packages/       packages/
   memory            codebase           reasoning         prd
       |                  |                 |               |
       +------------------+-----------------+---------------+
                                    |
                              packages/mcp-servers
                              (composition roots)
```

Core declares all four Ports. Packages implement them. `mcp-servers` wires
implementations to callers at startup. Zero circular dependencies.
