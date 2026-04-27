# Design Patterns — MCP Server Composition

**Methodology:** Christopher Alexander's pattern language.
Each pattern below names a recurring problem in a context, states the forces
that make it hard, proposes the solution that resolves the forces, and records
the resulting context in which further patterns become relevant.

These three patterns are the Alexander-style nucleus for this codebase. When a
fifth MCP server is needed, apply them in order:
1. PATTERN: Stub-First Composition Root (stabilise the topology first)
2. PATTERN: MCP Composition Root (build the real server boundary)
3. PATTERN: Tool-as-Adapter (wire each domain function to its MCP tool)

---

## PATTERN: MCP Composition Root

**Most load-bearing pattern.** Everything in this codebase is an application of it.

### Context

A domain package (`@agentic/memory`, `@agentic/codebase`, etc.) implements
rich domain logic. An MCP host (Claude, a test harness, an agent loop) needs to
call that logic as named tools over a stdio JSON-RPC channel. The domain package
has no knowledge of MCP; the MCP transport has no knowledge of the domain.

### Forces

- The domain package must stay transport-free (testable without an MCP host).
- The MCP transport must stay domain-free (swappable to HTTP without touching domain code).
- A naive flat file that both knows the domain AND manages the transport becomes a
  god-module: it violates SRP and cannot be tested without spawning the full process.
- Each new MCP server shares the same wiring shape; without a named pattern, each
  engineer invents a different structure.

### Solution

Create a `packages/mcp-servers/<name>/` package that is purely a composition root:

```
packages/mcp-servers/<name>/
  package.json          # name, bin, deps: @modelcontextprotocol/sdk + domain workspace dep
  tsconfig.json         # extends ../../../tsconfig.base.json
  src/
    index.ts            # < 60 lines: instantiate McpServer, call register*, connect transport
    tools/
      <topic>.ts        # one file per topic: exports register<Topic>Tools(server)
```

`src/index.ts` does exactly four things:
1. Instantiates `McpServer({ name, version })`.
2. Calls one `register*Tools(server)` function per topic file.
3. Calls `server.connect(new StdioServerTransport())`.
4. Writes startup confirmation to `process.stderr` (NEVER stdout).

`src/tools/<topic>.ts` exports one function: `register<Topic>Tools(server: McpServer): void`.
That function calls `server.registerTool(...)` once per tool in that topic.

### Why this resolves the forces

- The domain package (`@agentic/memory`) is imported only by the tool adapter files,
  not by the composition root itself. The root is thin; the adapters carry the coupling.
- The transport (`StdioServerTransport`) is instantiated only in `src/index.ts` and
  nowhere else. Swapping to HTTP requires editing one line.
- Each topic file is independently readable: `wiki.ts` registers the 8 wiki tools;
  `recall.ts` registers the 4 recall tools. SRP: one reason to change per file.
- The pattern is instantiated four times (memory, codebase, reasoning, prd) with
  parameter variation (which domain package, which tools). Adding a fifth server
  means copying the structure and filling in the tools.

### Resulting context

After applying this pattern, the workspace has a stable server boundary. The next
problem is: how does each domain function become a named MCP tool? That is addressed
by PATTERN: Tool-as-Adapter.

### Participants (in this codebase)

| Package | Status | Domain |
|---|---|---|
| `packages/mcp-servers/memory/` | live | `@agentic/memory` — 46 tools |
| `packages/mcp-servers/codebase/` | stub | `@agentic/codebase` — pending Phase 3 |
| `packages/mcp-servers/reasoning/` | stub | `@agentic/reasoning` — pending Phase 2 |
| `packages/mcp-servers/prd/` | stub | `@agentic/prd-pipeline` — pending Phase 2 |

### References

- PATTERN: Tool-as-Adapter (fills in the tool adapter files)
- PATTERN: Stub-First Composition Root (landing order when domain not yet built)

---

## PATTERN: Tool-as-Adapter

### Context

A domain function exists (e.g., `recallHandler(args, store)` in
`packages/memory/src/recall/recall-handler.ts`). An MCP host must call it as a
named JSON-RPC tool with a documented input schema, typed parameters, and a
consistent error response shape.

### Forces

- The domain function signature does not match the MCP tool interface: it takes
  typed domain objects and a store port; MCP tools take raw JSON with Zod validation.
- Error handling in the domain layer uses domain-specific error types; MCP clients
  expect a `{ error: string }` text envelope or an `isError: true` result.
- The 46 tool names and parameter names must match the Python source exactly
  (parity-oracle enforces this); any drift causes CI failure.
- If every tool adapter is written differently, the pattern diverges across engineers.

### Solution

Each tool adapter follows this template inside `src/tools/<topic>.ts`:

```typescript
server.registerTool(
  "tool_name",                         // exact name from MCP_TOOLS.md
  {
    description: "...",                // from MCP_TOOLS.md §"Purpose"
    inputSchema: {
      param_name: z.type().describe("..."),  // one line per parameter
    },
  },
  async (args) => {
    try {
      const result = await domainFunction(args, injectedStore);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }] };
    }
  },
);
```

Rules enforced by this pattern:
- **Parameter names** match MCP_TOOLS.md exactly (parity-oracle gate).
- **Defaults** match MCP_TOOLS.md exactly (e.g., `min_heat: 0.05`, `k: 60`).
- **Error envelope**: always `{ error: string }` in the text field, never a thrown exception.
- **Return shape**: always `{ content: [{ type: "text", text: JSON.stringify(...) }] }`.
- **Numeric constants**: annotated with `// source:` pointing to MCP_TOOLS.md or
  the originating paper (e.g., RRF k=60 → Cormack & Clarke 2009).
- **Stub note**: Phase 5 adapters that lack a real store inject a `note:` field
  in the response explaining what is pending. This makes stubs self-documenting.

### Why this resolves the forces

- The domain function is called through the adapter, which translates between
  the MCP JSON world and the domain typed world. Neither layer is polluted.
- The error envelope is uniform: every tool returns text content; MCP clients
  never see an unhandled exception crash the server.
- Parity with the Python source is enforced structurally: the inputSchema is
  derived directly from MCP_TOOLS.md, so parameter drift is visible in review.
- A new engineer reading `wiki.ts` sees eight identical structural units and
  understands the convention without reading this document.

### Resulting context

After applying Tool-as-Adapter for all tools in a topic, the topic file is
complete. The next concern is what to do when the domain package does not yet
exist. That is addressed by PATTERN: Stub-First Composition Root.

### Numeric constants with sources

| Constant | Value | Source |
|---|---|---|
| `min_heat` default | `0.05` | MCP_TOOLS.md §recall |
| `k` (RRF) | `60` | Cormack & Clarke (2009) "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods." SIGIR. |
| `cluster_threshold` | `0.6` | MCP_TOOLS.md §recall_hierarchical |
| `stale_threshold_days` | `30` | MCP_TOOLS.md §detect_gaps |
| `min_importance` (backfill) | `0.35` | MCP_TOOLS.md §backfill_memories (Ebbinghaus decay heuristic) |
| `min_importance` (import) | `0.4` | MCP_TOOLS.md §import_sessions |

---

## PATTERN: Stub-First Composition Root

### Context

A Phase plan requires a package to exist in the workspace before its domain
dependency is built. For example, `@agentic/mcp-server-codebase` needs
`@agentic/codebase` (the Rust subprocess adapter), which is a Phase 3
deliverable. Phase 5 runs before Phase 3 is complete.

### Forces

- `pnpm-workspace.yaml` and root `package.json` scripts reference all
  packages. If a package directory is absent, `pnpm install` fails.
- A package with no `src/index.ts` causes `tsc` to emit "no input files" error.
- A full composition root with tool implementations would need imports that
  don't exist yet, causing type errors that block CI.
- An empty directory is not a valid TypeScript package.

### Solution

Land a minimal but valid TypeScript package:

```
packages/mcp-servers/<name>/
  package.json    # name, bin, minimal deps (@modelcontextprotocol/sdk only — no domain dep yet)
  tsconfig.json   # extends ../../../tsconfig.base.json
  src/
    index.ts      # exports PORT_STATUS = "pending" as const + JSDoc pointing at the ADRs
```

The stub `src/index.ts`:
- Contains a `// STATUS: port-pending` header.
- References the design ADRs by path.
- Exports one constant (`PORT_STATUS`) to give TypeScript a non-empty module.
- Does NOT import `@modelcontextprotocol/sdk` (no real server logic; the import
  would succeed but is misleading).

The `package.json`:
- Lists `@modelcontextprotocol/sdk` as a dependency (future wiring will need it).
- Does NOT list the domain workspace package as a dependency (it doesn't exist yet).

### Why this resolves the forces

- The workspace topology is stable: `pnpm install` and `tsc` both succeed.
- The stub is self-documenting: a future engineer opening the file immediately
  understands what is pending and where the design decisions live.
- The transition from stub to real composition root is surgical: replace
  `src/index.ts`, add the domain workspace dep to `package.json`, add
  `src/tools/<topic>.ts` files. Nothing else changes.
- CI can enforce "all packages must build" without requiring all domains to be ready.

### Resulting context

Once the domain package is available, replace the stub by applying
PATTERN: MCP Composition Root.

### Participants (in this codebase)

| Package | Pending dependency | Design ADRs |
|---|---|---|
| `packages/mcp-servers/codebase/` | `@agentic/codebase` (Phase 3) | ADR-0001, ADR-0002, ADR-0003, ADR-0004 |
| `packages/mcp-servers/reasoning/` | `@agentic/reasoning` (Phase 2) | (inventory: port-inventory-zetetic) |
| `packages/mcp-servers/prd/` | `@agentic/prd-pipeline` (Phase 2) | ADR-0005, ADR-0006 |

---

## Generative Sequence for Adding a Fifth MCP Server

The ORDER in which the three patterns are applied determines whether the result
has topological integrity or not.

**Correct order:**

1. **PATTERN: Stub-First Composition Root** — land `package.json` + `src/index.ts`
   stub immediately. The workspace topology is now stable; CI passes.
2. **PATTERN: Tool-as-Adapter** — for each tool in the domain, write the Zod
   inputSchema adapter against the tool specification (not the unbuilt domain code).
   This forces the contract to be explicit before the implementation exists.
3. **PATTERN: MCP Composition Root** — wire the real `src/index.ts` once the
   domain package compiles. Replace the stub export; add `register*Tools` calls.

**Why this order:**

- Step 1 before step 3: the composition root cannot be real until the domain exists.
  The stub holds the topology while the domain is being built.
- Step 2 before step 3: writing the tool adapters forces the parameter contract to
  be specified against `MCP_TOOLS.md` before the implementation is available. This
  catches parity drift early (in code review) rather than late (in parity-oracle CI).
- Step 3 last: the composition root is the thinnest possible layer. It only wires;
  it does not decide. Writing it last ensures there is nothing left to decide.

**Wrong order (anti-pattern):**

- Building the domain package first, then designing the MCP interface: the domain
  shapes the interface instead of the interface contract shaping the domain.
- Writing the composition root (step 3) before the tool adapters (step 2):
  the root becomes a god-module that both registers tools AND implements them.
- Skipping the stub (step 1): the workspace topology is broken until the real server
  is complete, blocking all other packages from building.

---

## Fifteen Properties Audit — Memory MCP Server

Applying Alexander's fifteen structural properties as diagnostics:

| Property | Present? | Strength | Note |
|---|---|---|---|
| Levels of scale | yes | strong | workspace → package → index.ts → tools/<topic>.ts → registerTool call |
| Strong centers | yes | strong | each topic file has one clear purpose; index.ts is the unambiguous boundary |
| Boundaries | yes | strong | src/index.ts is the single crossing point between domain and transport |
| Alternating repetition | yes | moderate | 10 topic files follow the same register* pattern with topic variation |
| Positive space | yes | moderate | every file carries purpose; no grab-bag modules |
| Good shape | yes | strong | package name, bin entry, and import path all feel natural |
| Local symmetries | yes | strong | all registerTool calls have the same shape within and across files |
| Deep interlock | partial | moderate | tool adapters reference domain types implicitly; explicit type coupling is Phase 6 |
| Contrast | yes | strong | stub packages vs. live memory server are visually distinct (PORT_STATUS export) |
| Gradients | yes | moderate | stub → adapter-stub → full wiring is a clear gradient of completeness |
| Roughness | yes | moderate | Phase 5 stubs have "note" fields that acknowledge imperfection honestly |
| Echoes | yes | strong | all topic files end in `Tools` export name; all error helpers are identical |
| The void | yes | strong | index.ts has no tool logic; the stubs have no tool registration; each is empty of what it should not contain |
| Simplicity and inner calm | yes | strong | index.ts is 60 lines; each topic file is self-contained; no cross-topic imports |
| Not-separateness | partial | moderate | the memory server integrates with @agentic/memory but the full integration (store injection) is Phase 6 |

**Weakest property:** Not-separateness (memory server is not yet integrated with
its store). Strengthening: Phase 6 injects a real SQLiteMemoryStore at startup.

**Quality assessment:** The design has structural life — it is coherent, readable,
and honest about what is pending. The stubs do not pretend to be complete.
The generative sequence (stub first, adapters second, root third) is correct.
