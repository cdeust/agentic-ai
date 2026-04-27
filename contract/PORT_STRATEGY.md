# Port Strategy — `zetetic-team-subagents` → `packages/reasoning/`

Source: `/Users/cdeust/Developments/zetetic-team-subagents`
Target: `packages/reasoning/` in the monorepo
Date: 2026-04-26

---

## 1. Agent Prompts Move As-Is (Confirmed)

**Claim**: The `.md` agent prompt files are LLM-facing prompt content. They contain no code to compile or execute. They move without transformation.

**Evidence** (3 sampled files):

**Sample 1 — `agents/genius/liskov.md`** (313 lines)
File begins with YAML frontmatter followed by `<identity>`, `<routing>`, `<revolution>`, `<canonical-moves>`, `<blind-spots>`, `<refusal-conditions>`, `<memory>`, `<workflow>`, `<output-format>`, `<anti-patterns>`, `<zetetic>` XML-delimited sections. All content is natural language and Markdown. The only "code" is the Markdown table in the output format block. No executable statements, no imports, no function definitions. Tool references (`WebSearch`, `Read`, `Bash`) are prose instructions telling the LLM which Claude Code tools to invoke — they are not function calls.

**Sample 2 — `agents/genius/shannon.md`** (371 lines)
Identical structure. Frontmatter `tools: [Read, Edit, Write, Bash, Glob, Grep, WebFetch, WebSearch]` is declarative metadata, not executable. The `<canonical-moves>` block describes reasoning procedures in natural language.

**Sample 3 — `agents/genius/fermi.md`** (370 lines)
Identical structure. The `<memory>` block references `agent_topic: "genius-fermi"` — a string passed to a memory MCP tool. No code.

**Conclusion**: All 97 genius agents and all 19 team agents are pure Markdown. They move to `packages/reasoning/agents/genius/` and `packages/reasoning/agents/team/` verbatim. The `Primary sources` blocks inside the Markdown travel with the files — no `// source:` annotations to port.

**One path update required**: The `refactorer` agent has a `<domain-context>` that references `rules/coding-standards.md`. The port must update this path to `packages/reasoning/rules/coding-standards.md` or expose the file at an agreed-upon stable path.

---

## 2. Bash Scripts Port to TypeScript

**What ports**: The hook scripts (`hooks/*.sh`) and tool scripts (`tools/*.sh`) contain executable logic that must survive in the TypeScript monorepo. `tools/memory-mcp-server.py` is a separate concern (MCP server — port separately).

**Port principle**: Bash scripts port to TypeScript modules under `packages/reasoning/src/`. Each script becomes a typed function or service. The Bash → TS mapping:

| Bash construct | TypeScript equivalent |
|---|---|
| `exit 2` (blocking hook) | `throw new HookBlockedError(reason)` |
| `exit 0` (pass-through) | `return { blocked: false }` |
| stdin JSON parsing (`jq`) | `JSON.parse(await readStdin())` typed against `ToolEvent` interface |
| Environment variables (`$CLAUDE_PLUGIN_ROOT`) | Injected via `FileSystemPort` constructor parameter |
| `git diff --cached` | `BashPort.exec('git diff --cached')` — or a typed `GitPort.getStagedDiff()` |
| `grep` pattern matching | TypeScript regex on strings |
| `~/.claude/*.json` file reads/writes | `FileSystemPort.read(path)` / `FileSystemPort.write(path, content)` |

**Sketch TS API for hook invocation**:

```typescript
// packages/reasoning/src/hooks/types.ts

export interface ToolEvent {
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id?: string;
}

export interface HookResult {
  blocked: boolean;
  reason?: string;    // present when blocked = true
  message?: string;   // advisory message (blocked = false)
}

export type HookHandler = (event: ToolEvent) => Promise<HookResult>;

// packages/reasoning/src/hooks/pre-tool-claim-gate.ts
export function createClaimGateHook(fs: FileSystemPort): HookHandler {
  return async (event: ToolEvent): Promise<HookResult> => {
    // ... port of pre-tool-claim-gate.sh logic
  };
}
```

**`invokeGenius` API sketch**:

```typescript
// packages/reasoning/src/ports/reasoning.port.ts

export interface InvokeOptions {
  model?: 'opus' | 'sonnet' | 'haiku';
  effort?: 'low' | 'medium' | 'high';
  sessionId?: string;
}

export interface AgentResponse {
  content: string;
  agentName: string;
  model: string;
  tokensUsed?: number;
}

export interface ReasoningPort {
  // Invoke by canonical name: invokeGenius("liskov", "...")
  invokeGenius(name: string, prompt: string, opts?: InvokeOptions): Promise<AgentResponse>;

  // Invoke by shape/domain facet: invokeByShape("structural", "...")
  invokeByShape(shape: string, prompt: string, opts?: InvokeOptions): Promise<AgentResponse>;

  // Invoke a team specialist: invokeTeamAgent("engineer", "...")
  invokeTeamAgent(role: TeamAgentRole, prompt: string, opts?: InvokeOptions): Promise<AgentResponse>;

  // Faceted lookup: listAgents({ domain: "computer-science", era: "20th-c" })
  listAgents(filter?: AgentFilter): AgentDescriptor[];

  // Load a rule file: getRuleFile("coding-standards")
  getRuleFile(name: string): string;
}

export type TeamAgentRole =
  | 'architect' | 'code-reviewer' | 'data-scientist' | 'dba'
  | 'devops-engineer' | 'engineer' | 'experiment-runner' | 'frontend-engineer'
  | 'latex-engineer' | 'mlops' | 'orchestrator' | 'paper-writer'
  | 'professor' | 'refactorer' | 'research-scientist' | 'reviewer-academic'
  | 'security-auditor' | 'test-engineer' | 'ux-designer';
```

---

## 3. Claude Code Agent Discovery Contract

**How Claude Code currently discovers agents in this repo**:

1. `.claude-plugin/plugin.json` defines a `postInstall.command`: `bash ${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh install`
2. `scripts/setup.sh` copies the agent files to `~/.claude/agents/` (Claude Code's local agent directory)
3. Claude Code at runtime reads `~/.claude/agents/*.md` and makes them available as subagents
4. The `hooks` section of `plugin.json` wires hook scripts to Claude Code's hook event system via the `type: "command"` mechanism — each hook fires as a subprocess receiving a JSON payload on stdin

**The discovery contract the TS port must preserve**:

| Contract Element | Source Convention | TS Port Requirement |
|---|---|---|
| Agent file location | `~/.claude/agents/<name>.md` (after setup.sh install) | `packages/reasoning/agents/genius/<name>.md` at install time; symlinked or copied to `~/.claude/agents/` by the monorepo's `setup` command |
| Agent frontmatter fields | `name:`, `description:`, `model:`, `effort:`, `when_to_use:`, `agent_topic:`, `shapes:`, `tools:`, `memory_scope:` | Parsed by `AgentRegistry` at startup; TypeScript `AgentDescriptor` interface must map these fields 1:1 |
| Hook registration | `plugin.json` `hooks` block → Claude Code reads this on plugin install | Monorepo must emit a compatible `plugin.json` or `~/.claude/settings.local.json` hook entries pointing to TS-compiled hook runners |
| Hook invocation | Subprocess: script receives JSON on stdin, exits 0 (pass) or non-zero (block) | TS hooks compile to Node.js scripts invokable as `node hooks/<name>.js`; exit codes 0 / 2 preserved |
| Memory scope | Each genius agent has `memory_scope: genius` and `agent_topic: genius-<name>` | The memory MCP server (`tools/memory-mcp-server.py`) must be ported or proxied; topic keys must be preserved |

---

## 4. Faceted Access Plan (Ranganathan PMEST)

The inventory establishes five independent facets for the 97 genius agents. These underwrite the `invokeByShape`, `listAgents`, and related API calls.

### Facet Schema

| Facet | PMEST Category | Description | Example Values | Cardinality |
|---|---|---|---|---|
| **name** | Personality (primary) | Canonical lowercase agent name | `liskov`, `shannon`, `fermi` | 97 (unique) |
| **domain** | Personality (secondary) | Intellectual discipline of origin | `computer-science`, `mathematics`, `biology`, `physics`, `philosophy`, `economics` | ~23 domains |
| **style** | Energy | Primary reasoning operation the pattern performs | `correctness-proof`, `estimation-bounding`, `causal-analysis`, `anomaly-detection`, `classification`, `feedback-stability` | ~30 styles |
| **era** | Time | Approximate century of the historical instance | `ancient`, `medieval`, `early-modern`, `19th-c`, `20th-c`, `21st-c` | 6 |
| **shape** | Matter | Named reasoning shape (from frontmatter `shapes:` field) | `substitutability-as-contract`, `behavioral-subtyping`, `order-of-magnitude-bracketing` | ~300 unique shapes across corpus |

### Orthogonality Check

Each facet is independent of the others:
- `era` does not determine `domain` (Archimedes is `ancient` + `mathematics`; Aristotle is `ancient` + `philosophy` + `logic`)
- `domain` does not determine `style` (both `mathematics` and `biology` have agents using `pattern-matching` style)
- `name` determines all other facets (it is the primary key), but no other facet determines `name`
- `shape` is the most granular facet — a single agent can have 3–6 shapes (the `shapes:` frontmatter array)

### Access Path Examples

```typescript
// By canonical name (O(1) hash lookup)
invokeGenius("liskov", prompt)

// By domain (returns first match by relevance; or listAgents + pick)
invokeByShape("structural", prompt)
listAgents({ domain: "computer-science" })
// → [dijkstra, hopper, kay, knuth, lamport, liskov, turing, vonneumann]

// By era
listAgents({ era: "ancient" })
// → [archimedes, aristotle, nagarjuna, panini, zhuangzi]

// By style
listAgents({ style: "correctness-proof" })
// → [dijkstra, lamport, liskov, godel]

// Combined facets (intersection)
listAgents({ domain: "mathematics", era: "20th-c" })
// → [erdos, noether, polya, ramanujan, poincare, mandelbrot]

// By shape (from frontmatter)
listAgents({ shape: "substitutability-as-contract" })
// → [liskov]
listAgents({ shape: "order-of-magnitude" })
// → [fermi]
```

### AgentRegistry Implementation Sketch

```typescript
// packages/reasoning/src/registry/agent-registry.ts

import { parse as parseFrontmatter } from 'gray-matter';  // or hand-rolled YAML parser
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export class AgentRegistry {
  private readonly agents: Map<string, AgentDescriptor> = new Map();
  private readonly byDomain: Map<string, AgentDescriptor[]> = new Map();
  private readonly byEra: Map<string, AgentDescriptor[]> = new Map();
  private readonly byStyle: Map<string, AgentDescriptor[]> = new Map();
  private readonly byShape: Map<string, AgentDescriptor[]> = new Map();

  constructor(private readonly agentsRoot: string) {
    this.load();
  }

  private load(): void {
    const geniusDir = join(this.agentsRoot, 'genius');
    for (const file of readdirSync(geniusDir)) {
      if (!file.endsWith('.md') || file === 'INDEX.md') continue;
      const content = readFileSync(join(geniusDir, file), 'utf-8');
      const { data: fm } = parseFrontmatter(content);
      const descriptor: AgentDescriptor = {
        name: fm.name,
        file: join(geniusDir, file),
        lines: content.split('\n').length,
        moves: (content.match(/^\*\*Move \d/gm) ?? []).length,
        domain: fm.domain ?? 'unknown',
        era: fm.era ?? 'unknown',
        style: fm.style ?? [],
        shapes: fm.shapes ?? [],
        tools: fm.tools ?? [],
        content,  // loaded once; the LLM prompt is this content
      };
      this.agents.set(fm.name, descriptor);
      this.index(descriptor);
    }
  }

  // ... index by facet, listAgents(filter), getByName(name)
}
```

Note: The `domain`, `era`, and `style` facets are NOT currently in the frontmatter of the source agent files. They exist only in this inventory document. To make the registry work, either:
- **Option A**: Enrich each agent's frontmatter with `domain:`, `era:`, `style:` fields (requires 97 file edits)
- **Option B**: Maintain the facet mapping in a separate `agents/genius/facets.json` file generated from this inventory (zero agent file edits)

**Recommendation: Option B**. The agent files are LLM-facing prompt content — adding operational metadata to them conflates concerns. Generate `facets.json` from this inventory document as a build step.

---

## 5. Sufficiency Assessment of Proposed API Surface

### What is sufficient

- `invokeGenius(name, prompt)` — covers the O(1) by-name access path
- `invokeByShape(shape, prompt)` — covers the shape/domain access path (Energy facet)
- `invokeTeamAgent(role, prompt)` — covers team agents
- `listAgents(filter)` — covers all multi-facet queries
- `getRuleFile(name)` — covers rule file access

### What is under-specified

| Gap | Description | Fix |
|---|---|---|
| **No hook invocation API** | The `ReasoningPort` has no method for running hooks (pre-commit-zetetic, pre-tool-claim-gate, etc.). Hooks are currently invoked as subprocesses by Claude Code. | Add `runHook(event: HookEvent): Promise<HookResult>` to the port, or keep hooks as standalone Node.js scripts registered in `plugin.json` — the latter is simpler and preserves the Claude Code contract. Recommend: keep hooks separate from `ReasoningPort`. |
| **No memory scope API** | Each genius agent has an `agent_topic` for memory MCP calls (e.g. `genius-fermi`). The `ReasoningPort` has no `recall(agentTopic, query)` or `remember(agentTopic, content)`. | Either expose memory through `ReasoningPort` or keep it as a separate `MemoryPort` (recommended — memory and reasoning are different concerns per Clean Architecture §2.1). |
| **No `invokeByEra` convenience** | The facet schema includes `era` but there is no `invokeByEra` method. `listAgents({ era: 'ancient' })` + manual pick works but is less ergonomic. | Add `invokeByFacet(facet: Partial<AgentFilter>, prompt, opts)` as a generalized version that covers era, domain, style, shape uniformly. |
| **`AgentFilter` is under-typed** | `domain`, `era`, `style` are `string` but should be typed unions derived from the facet schema. | Generate literal union types from `facets.json` at build time: `type AgentDomain = 'computer-science' \| 'mathematics' \| ...` |
| **No `AgentDescriptor.content` field** | The `AgentDescriptor` interface does not include the raw Markdown content of the agent file. The LLM invocation needs this content as the system prompt. | Add `content: string` to `AgentDescriptor` (loaded lazily to avoid memory pressure with 116 agents × ~350 lines). |
| **No versioning** | `plugin.json` is at version `2.13.1`. The TS port has no version contract. | Add `version(): string` to `ReasoningPort` returning the agent corpus version; derive from `plugin.json`. |

### Summary Verdict

The proposed API surface is **necessary but not sufficient**. The six gaps above must be addressed before the port plan is complete. The two highest-priority gaps are: (1) specifying how hooks integrate — subprocess vs. in-process — and (2) adding `content: string` to `AgentDescriptor` so the LLM invocation layer has the prompt text.

---

## 6. Directory Layout for `packages/reasoning/`

```
packages/reasoning/
  src/
    ports/
      reasoning.port.ts          # ReasoningPort interface
    registry/
      agent-registry.ts          # AgentRegistry class
      facets.json                # Generated facet mappings (domain/era/style per agent)
    hooks/
      types.ts                   # ToolEvent, HookResult, HookHandler
      pre-tool-claim-gate.ts
      pre-commit-zetetic.ts
      pre-push-provenance.ts
      pre-edit-layer-check.ts
      pre-tool-secret-shield.ts
      post-research-provenance.ts
      post-tool-error-routing.ts
      session-start.ts
      session-end.ts
      # ... remaining hooks
    index.ts                     # Public exports
  agents/
    genius/
      alexander.md               # 97 files — MOVED AS-IS
      alkhwarizmi.md
      # ... all 97
      INDEX.md                   # navigation index — moved as-is
    team/
      architect.md               # 19 files — MOVED AS-IS
      engineer.md
      # ... all 19
  rules/
    coding-standards.md          # MOVED AS-IS (1 file)
  plugin.json                    # Updated plugin manifest (from .claude-plugin/plugin.json)
  package.json
  tsconfig.json
```
