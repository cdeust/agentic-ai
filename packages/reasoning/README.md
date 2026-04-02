# Claude Code Agents

A collection of specialized Claude Code agents built on a shared engineering methodology: **zetetic scientific rigor, Clean Architecture, and SOLID principles**. The agents are the vehicle — the methodology is the value.

## Methodology

These principles are the foundation of every agent. They are not suggestions — they are mandatory constraints that every agent inherits regardless of its specialization.

### Zetetic Scientific Standard

The zetetic method: do not accept claims without verifiable evidence. This applies to code, architecture, algorithms, and technical decisions equally.

1. **No implementation without a source.** Every algorithm, equation, constant, and threshold must trace to a published paper, verified benchmark data, or documented empirical result. If no source exists, say "I don't know" and stop.

2. **Multiple sources required.** A single paper is a hypothesis, not a fact. Cross-reference with at least one independent source (another paper, a benchmark, a reference implementation) before implementing.

3. **Verify sources before accepting.** Read the actual paper — not summaries, not blog posts, not what someone claims the paper says. Extract the exact equations. Check the experimental conditions match your setting.

4. **No invented constants.** Every hardcoded number must come from the paper's equations, the paper's experimental results, or measured ablation data from your own benchmarks. If a value can't be justified, it doesn't go in the code.

5. **Benchmark before commit.** Every change must be benchmarked. No regression accepted. Results must be reproducible.

6. **Say "I don't know" when you don't know.** Do not fabricate solutions, invent heuristics, or approximate algorithms without explicitly stating what was changed and why. A confident wrong answer destroys trust. An honest "I don't know" preserves it.

7. **Audit trail.** Every module must cite its sources. Every adaptation from the source material must be documented with justification.

### Clean Architecture

Concentric layers with dependencies pointing inward. The exact layer names vary by project — identify them from the codebase.

```
TRANSPORT → SERVER → HANDLERS → CORE ← SHARED
                                  ↓
                            INFRASTRUCTURE → SHARED
```

- **Core / Domain**: Pure business logic. Zero I/O. No filesystem, network, or database access. Testable without mocks.
- **Infrastructure / Adapters**: All I/O. Implements interfaces defined by core.
- **Handlers / Use Cases / Controllers**: Composition roots — the ONLY layer that wires core + infrastructure together.
- **Shared / Common / Utils**: Pure utility functions with no dependencies on other project layers.
- Inner layers NEVER import outer layers. This rule is absolute regardless of language.

#### Layer Dependency Rules

| Layer | May Import | Must NOT Import |
|---|---|---|
| shared/ | Standard library only | core, infrastructure, handlers, server |
| core/ | shared/ only | infrastructure, handlers, server, I/O |
| infrastructure/ | shared/, standard library | core, handlers, server |
| handlers/ | core, infrastructure, shared | server, transport |
| server/ | handlers | core, infrastructure (except via handlers) |

### SOLID Principles

- **Single Responsibility**: One reason to change per module/class. If it does two things, split it.
- **Open/Closed**: Extend behavior through new implementations, not by modifying existing ones. Use the language's abstraction mechanism (interfaces, protocols, traits) and registries, not conditional chains.
- **Liskov Substitution**: Subtypes must be substitutable. Never override a method to throw "not implemented."
- **Interface Segregation**: Small, focused interfaces. No god interfaces.
- **Dependency Inversion**: Core defines interfaces. Infrastructure implements them. Handlers inject implementations at construction time.

### Reverse Dependency Injection

- Core modules declare what they need via interface types in their constructors or function signatures.
- Factory functions in the composition root layer assemble the dependency graph.
- No service locators. No global mutable state. No singletons except explicit configuration objects.

### Root Cause Thinking

- NEVER apply band-aid fixes. Trace failures to their architectural origin.
- If a fix requires violating a layer boundary, the design is wrong — fix the design.
- If a function needs a new dependency, propagate through the constructor chain rather than importing directly.
- If adding a conditional for a special case, ask: should this be a separate strategy/implementation instead?

### 3R's — Readability, Reliability, Reusability

- **Readability**: Descriptive names. Short methods (~40 lines max). Focused files (~300 lines max). No magic numbers. Logic flows top-down.
- **Reliability**: Use the language's type system fully. Validate at system boundaries only. Trust internal contracts.
- **Reusability**: Extract shared logic as pure functions. Parameterize via DI. But do NOT prematurely abstract — three concrete uses before extracting.

### Anti-Patterns to Reject

- Catching/swallowing errors "just in case"
- Utility grab-bag modules with no cohesive purpose
- Passing untyped dictionaries instead of typed data structures
- Dead code, backward-compatibility shims, or code with no current caller
- Error handling for scenarios that can't happen
- Abstractions for one-time operations

---

## Agents

| Agent | Role | Specialty |
|---|---|---|
| **engineer** | Software Engineer | Clean Architecture, SOLID, root-cause problem solving — adapts to any language/stack |
| **architect** | Software Architect | Module decomposition, layer boundaries, dependency analysis, refactoring strategy |
| **reviewer** | Code Reviewer | Clean Architecture enforcement, SOLID violations, architectural integrity |
| **tester** | Test Engineer | Architecture verification, wiring checks, CI integrity |
| **dba** | Database Specialist | Schema design, query optimization, migrations, index tuning — any engine |
| **frontend** | Frontend Developer | React/TypeScript, component-driven design, accessibility |
| **devops** | DevOps Engineer | CI/CD pipelines, Docker, provisioning, monitoring, deployment |
| **security** | Security Expert | Threat modeling, OWASP, supply chain, defense-in-depth |
| **researcher** | Research Scientist | Literature review, paper analysis, benchmark improvement |
| **ux** | UX/UI Specialist | Usability, accessibility, information architecture, design systems |
| **orchestrator** | Multi-Agent Coordinator | Spawns, coordinates, and merges work from parallel agents |

---

## Installation

### Global (all projects)

```bash
git clone https://github.com/nichochar/claude-agents.git
cp claude-agents/agents/*.md ~/.claude/agents/
```

### Per-project

```bash
mkdir -p .claude/agents
cp claude-agents/agents/*.md .claude/agents/
```

## Usage

Once installed, agents are available as subagent types in Claude Code:

```
Use the engineer agent to fix the authentication bug in login.py
```

```
Use the reviewer agent to review the changes in this PR
```

```
Use the orchestrator to run architect, engineer, and tester in parallel on this task
```

### The Orchestrator

The orchestrator decomposes tasks, spawns specialized agents in parallel using isolated git worktrees, and merges results:

1. Analyzes the task and decides which agents to spawn
2. Creates isolated worktrees for parallel work
3. Monitors progress and resolves conflicts
4. Merges results back to the main branch

## Cortex Memory Integration (Optional)

Each agent includes a "Cortex Memory Integration" section for [Cortex](https://github.com/nichochar/cortex), a persistent memory MCP server. This enables agents to recall prior work, remember decisions, and share context across sessions. Without Cortex, the memory sections are safely ignored.

## Customization

Each agent is a Markdown file with YAML frontmatter:

```yaml
---
name: engineer
description: Short description shown in agent selection
model: opus  # or sonnet, haiku
---
```

You can:
- **Change the model** — use `sonnet` for faster/cheaper, `opus` for complex reasoning
- **Edit the system prompt** — tailor to your team's standards
- **Add project-specific rules** — append sections for your stack or compliance needs
- **Remove the Cortex section** — if not using persistent memory

## License

MIT
