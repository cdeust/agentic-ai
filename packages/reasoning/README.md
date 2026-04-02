# Claude Code Agents

A collection of specialized Claude Code agents for software engineering teams. Each agent is a senior-level expert in its domain, designed to work autonomously or in parallel via the orchestrator.

## Agents

| Agent | Role | Specialty |
|---|---|---|
| **engineer** | Software Engineer | Clean Architecture, SOLID, root-cause problem solving — adapts to any language/stack |
| **architect** | Software Architect | Module decomposition, layer boundaries, dependency analysis, refactoring strategy |
| **reviewer** | Code Reviewer | Clean Architecture enforcement, SOLID violations, architectural integrity |
| **tester** | Test Engineer | Clean Architecture verification, wiring checks, CI integrity |
| **dba** | Database Specialist | Schema design, query optimization, migrations, index tuning — any engine |
| **frontend** | Frontend Developer | React/TypeScript, component-driven design, accessibility |
| **devops** | DevOps Engineer | CI/CD pipelines, Docker, provisioning, monitoring, deployment |
| **security** | Security Expert | Threat modeling, OWASP, supply chain, defense-in-depth |
| **researcher** | Research Scientist | Literature review, paper analysis, benchmark improvement |
| **ux** | UX/UI Specialist | Usability, accessibility, information architecture, design systems |
| **orchestrator** | Multi-Agent Coordinator | Spawns, coordinates, and merges work from parallel agents |

## Installation

### Global (all projects)

```bash
# Clone and symlink to ~/.claude/agents/
git clone https://github.com/nichochar/claude-agents.git
cp claude-agents/agents/*.md ~/.claude/agents/
```

### Per-project

```bash
# Copy into your project's .claude/agents/ directory
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
Use the orchestrator to run architect, engineer, and tester in parallel on the refactoring task
```

### The Orchestrator

The orchestrator agent is designed to coordinate multiple agents working in parallel using git worktrees. It:

1. Analyzes the task and decides which agents to spawn
2. Creates isolated worktrees for parallel work
3. Monitors progress and resolves conflicts
4. Merges results back to the main branch

Example:
```
Use the orchestrator to implement the new API endpoint — have architect design it,
engineer implement it, tester write tests, and reviewer check the result
```

## Cortex Memory Integration (Optional)

Each agent includes a "Cortex Memory Integration" section that connects to [Cortex](https://github.com/nichochar/cortex), a persistent memory MCP server for Claude Code. This enables agents to:

- **Recall** prior work before starting a task
- **Remember** decisions and lessons after completing work
- **Share context** across sessions and between agents

If you don't use Cortex, the memory sections are safely ignored — agents work standalone without any memory integration.

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
- **Change the model** — use `sonnet` for faster/cheaper agents, `opus` for complex reasoning
- **Edit the system prompt** — tailor principles and checklists to your team's standards
- **Add project-specific rules** — append sections for your tech stack, conventions, or compliance requirements
- **Remove the Cortex section** — if not using Cortex memory integration

## License

MIT
