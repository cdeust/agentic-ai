# Claude Code Agents

A collection of specialized Claude Code agents built on a shared engineering methodology: **zetetic scientific rigor, Clean Architecture, and SOLID principles**. The agents are the vehicle — the methodology is the value.

## Methodology

These principles are the foundation of every agent. They are not suggestions — they are mandatory constraints that every agent inherits regardless of its specialization.

### Zetetic Scientific Standard

The zetetic method (Greek *zetētikos* — "disposed to inquire"): do not accept claims without verified evidence. Inquiry is not passive — every agent has an epistemic duty to actively gather evidence, not merely respond to what is given.

Grounded in published epistemology:
- **Friedman 2020** (*Zetetic Epistemology*) — norms govern the entire course of inquiry, not just what to believe given evidence.
- **Flores & Woodard 2023** (*Epistemic norms on evidence-gathering*) — agents are epistemically criticizable for poor evidence-gathering: epistemic bubbles, gullibility, laziness, confirmation bias.
- **Adel.M** (*The four pillars of zetetics*) — "not just doubting, a method to discern, purify, decide."

#### The Four Pillars

1. **Logical** — formal coherence. *"Is it consistent?"* Check internal structure, validity, contradictions, fallacies.
2. **Critical** — epistemic correspondence. *"Is it true?"* Compare claims against evidence, accumulated knowledge, verifiable data.
3. **Rational** — the balance between goals, means, and context. *"Is it useful?"* Evaluate practical rationality given the circumstances.
4. **Essential** — the hierarchy of importance. *"Is it necessary?"* The thought that has learned to remove, not only to add. *"Why this? Why now? And why not something else?"*

> *Where logical thinking builds, rational thinking guides, critical thinking dismantles, **essential thinking selects.***

#### Implementation Rules

1. **No implementation without a source.** Every algorithm, equation, constant, and threshold must trace to a published paper, verified benchmark data, or documented empirical result. If no source exists, say "I don't know" and stop.
2. **Multiple sources required.** A single paper is a hypothesis, not a fact. Cross-reference with at least one independent source before implementing.
3. **Verify sources before accepting.** Read the actual paper — not summaries, not blog posts. Extract the exact equations. Check conditions match your setting.
4. **No invented constants.** Every hardcoded number must come from paper equations, experimental results, or measured ablation data.
5. **Benchmark before commit.** Every change must be benchmarked. No regression accepted.
6. **Say "I don't know" when you don't know.** A confident wrong answer destroys trust. An honest "I don't know" preserves it.
7. **Actively seek disconfirming evidence.** Epistemic bubbles, gullibility, and closed-mindedness are zetetic failures. Diversify your sources.

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

### Engineering

| Agent | Role | Specialty |
|---|---|---|
| **engineer** | Software Engineer | Clean Architecture, SOLID, root-cause problem solving — adapts to any language/stack |
| **architect** | Software Architect | Module decomposition, layer boundaries, dependency analysis, refactoring strategy |
| **code-reviewer** | Code Reviewer | Clean Architecture enforcement, SOLID violations, architectural integrity |
| **test-engineer** | Test Engineer | Architecture verification, wiring checks, CI integrity |
| **dba** | Database Specialist | Schema design, query optimization, migrations, index tuning — any engine |
| **frontend-engineer** | Frontend Developer | React/TypeScript, component-driven design, accessibility |
| **devops-engineer** | DevOps Engineer | CI/CD pipelines, Docker, provisioning, monitoring, deployment |
| **security-auditor** | Security Auditor | Threat modeling, OWASP, supply chain, defense-in-depth |
| **ux-designer** | UX/UI Designer | Usability, accessibility, information architecture, design systems |

### Research & Academic

| Agent | Role | Specialty |
|---|---|---|
| **research-scientist** | Research Scientist | Literature review, paper analysis, benchmark improvement, finding published algorithms |
| **paper-writer** | Scientific Writer | Argument structure, claim-evidence chains, narrative flow, venue conventions |
| **experiment-runner** | Experiment Designer | Ablation studies, hyperparameter search, reproducibility, statistical rigor |
| **data-scientist** | Data Analyst | EDA, feature engineering, data quality, bias auditing, dataset documentation |
| **mlops** | ML Infrastructure | Training pipelines, GPU optimization, distributed training, model serving |
| **reviewer-academic** | Peer Review Simulator | Pre-submission review as a NeurIPS/CVPR/ICML reviewer would |
| **latex-engineer** | LaTeX Specialist | Templates, figures, tables, TikZ/PGFPlots, bibliography, compilation |
| **professor** | Academic Professor | Concept explanations, mental models, Socratic method, lectures, exercises |

### Coordination

| Agent | Role | Specialty |
|---|---|---|
| **orchestrator** | Multi-Agent Coordinator | Spawns, coordinates, and merges work from parallel agents. Synthesizes dynamic agents on the fly |

---

## Installation

### Global (all projects)

```bash
git clone https://github.com/cdeust/zetetic-team-subagents.git
cp zetetic-team-subagents/agents/*.md ~/.claude/agents/
```

### Per-project

```bash
mkdir -p .claude/agents
cp zetetic-team-subagents/agents/*.md .claude/agents/
```

## Usage

Once installed, agents are available as subagent types in Claude Code:

```
Use the engineer agent to fix the authentication bug in login.py
```

```
Use the code-reviewer agent to review the changes in this PR
```

```
Use the orchestrator to run architect, engineer, and test-engineer in parallel on this task
```

### The Orchestrator

The orchestrator decomposes tasks, spawns specialized agents in parallel using isolated git worktrees, and merges results:

1. Analyzes the task and decides which agents to spawn
2. Creates isolated worktrees for parallel work
3. Monitors progress and resolves conflicts
4. Merges results back to the main branch

#### Dynamic Agent Synthesis

When a task requires expertise outside the 17 static agents, the orchestrator **synthesizes ephemeral agents on the fly**:

1. **Decision tree**: exact match → use static agent, partial match → augment delegation, no match → synthesize
2. **Base template**: every dynamic agent inherits three non-negotiable invariant sections — memory (Cortex integration), zetetic (scientific standard), and architecture (Clean Architecture + SOLID, when writing code)
3. **Generated sections**: the orchestrator composes role-specific identity, thinking, principles, workflow, and anti-patterns tailored to the domain
4. **Lifecycle**: the agent lives only for the task — its context is discarded on completion, but its knowledge persists through Cortex memory under a scoped `agent_topic`
5. **Quality gates**: pre-spawn validation (7 checks) and post-completion verification ensure dynamic agents maintain the same rigor as static ones
6. **Promotion**: if the same archetype is synthesized 3+ times, the orchestrator recommends creating a permanent static agent

## Running Agents as Standalone CLI Sessions (Worktrees, No Permission Blocks)

Using agents via the parent session's subagent mechanism (`Use the engineer agent to …`) is convenient, but it shares the parent's context window and funnels every tool call through the parent's permission prompts. For real parallel work — one agent per terminal, each in its own git worktree, none of them blocked on approval dialogs — spawn each agent as its **own `claude` process**.

### The spawn script

```bash
# from inside the repo you want the agent to work ON
/path/to/zetetic-team-subagents/scripts/spawn-agent.sh engineer "Fix the auth bug in login.py"

# or interactive REPL
/path/to/zetetic-team-subagents/scripts/spawn-agent.sh architect
```

What it does:

1. Reads `agents/<name>.md` and strips the YAML frontmatter to get the raw system prompt.
2. Creates a fresh git worktree next to your repo on branch `agent/<name>/<timestamp>` — the agent cannot stomp on your working tree.
3. Launches `claude` in that worktree with:
   - `--append-system-prompt "<agent body>"` — installs the agent persona into a *top-level* session (not a subagent).
   - `--permission-mode bypassPermissions` — no interactive approval prompts, so the session is not blocked waiting on you to click allow.
   - `-p "<task>"` for headless one-shot, or no `-p` for an interactive REPL.

Because each agent is a separate `claude` process with its own PID, context window, and working directory, you can open N terminals and run N agents truly in parallel:

```bash
# terminal 1
spawn-agent.sh architect    "Propose a module split for src/core"
# terminal 2
spawn-agent.sh engineer     "Implement the split from the architect branch"
# terminal 3
spawn-agent.sh test-engineer "Write coverage for the new modules"
# terminal 4
spawn-agent.sh code-reviewer "Review diff against main"
```

When an agent finishes, merge its branch back the normal way:

```bash
git -C <main-repo> merge agent/engineer/20260407-154210
git worktree remove ../<repo>-engineer-20260407-154210
```

### Authentication

Spawned sessions reuse whatever credentials your normal `claude` command already uses — the script does **not** force an API key. The CLI's standard resolution order applies:

1. OAuth token from `claude /login` or `claude setup-token` (Claude Pro / Max / Team subscription)
2. macOS Keychain
3. `ANTHROPIC_API_KEY` environment variable
4. `apiKeyHelper` configured in settings

So if `claude` works interactively for you, `spawn-agent.sh` will work with the same identity and billing. Avoid `--bare` (not used by the script) — that flag explicitly disables OAuth/keychain and requires `ANTHROPIC_API_KEY`, which is usually not what you want on a subscription plan.

### Why `bypassPermissions`?

`--permission-mode bypassPermissions` disables the approval UI for the session — the minimum needed to unblock a headless agent. Use it **only inside an isolated worktree** (which the script enforces) so a runaway agent cannot damage your main checkout. If you want a stricter posture, swap it for `acceptEdits` (auto-approves file edits only, still prompts for shell) — edit the script's `--permission-mode` line.

### Manual invocation (no script)

If you do not want the script, the one-liner equivalent is:

```bash
git worktree add -b agent/engineer/test ../myrepo-engineer
cd ../myrepo-engineer
claude --permission-mode bypassPermissions \
       --append-system-prompt "$(awk 'BEGIN{f=0}/^---$/{f++;next}f>=2' /path/to/zetetic-team-subagents/agents/engineer.md)" \
       -p "Fix the auth bug in login.py"
```

The `awk` strips the YAML frontmatter; everything after the second `---` is the agent's system prompt.

### When to use which mode

| Mode | Use when |
|---|---|
| Parent-session subagent (`Use the engineer agent…`) | Light delegation inside an existing conversation; you want the parent to synthesize results. |
| `spawn-agent.sh` standalone worktree | True parallelism, isolated filesystems, independent context windows, no permission prompts blocking automation. |
| `orchestrator` agent | You want one coordinator to do the spawning and merging for you. |

## Cortex Memory Integration (Optional)

Each agent includes a "Cortex Memory Integration" section for [Cortex](https://github.com/cdeust/Cortex), a persistent memory MCP server. This enables agents to recall prior work, remember decisions, and share context across sessions. Without Cortex, the memory sections are safely ignored.

## Customization

Each agent is a Markdown file with YAML frontmatter:

```yaml
---
name: engineer
description: Software engineer specializing in Clean Architecture, SOLID, and root-cause problem solving
model: opus  # or sonnet, haiku
when_to_use: When code needs to be written, modified, or fixed
agent_topic: engineer
---
```

You can:
- **Change the model** — use `sonnet` for faster/cheaper, `opus` for complex reasoning
- **Edit the system prompt** — tailor to your team's standards
- **Add project-specific rules** — append sections for your stack or compliance needs
- **Remove the Cortex section** — if not using persistent memory

## License

MIT
