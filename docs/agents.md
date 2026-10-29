# Agents

Two kinds of agents exist in this repository: worker agents that serve users at run time, and review subagents that serve maintainers at pull request time.

## Worker agents

A worker agent is a Claude Agent SDK `query()` run inside a worker container. It is created per execution by `services/<name>/worker` and has no state between runs.

### memory worker (`services/memory/worker/`)

| Aspect         | Value                                                                                                                                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role           | Answer `recall` (ground a summary in stored memories) and perform `remember` (store one memory).                                                                                                                                                                                                      |
| Entry point    | `main.ts`: reads one `WorkerInput` JSON on stdin, writes one `WorkerOutput` JSON on stdout, exit code 0 (result written) or 2 (input unusable).                                                                                                                                                       |
| Core           | `run-worker.ts`: pure with respect to I/O; takes an `AgentPort` and `InternalTools`. `sdk-agent.ts` is the only file importing the SDK.                                                                                                                                                               |
| Internal tools | `memory_search(query, limit)` and `memory_insert(content, tags)`, exposed to the agent as an in-process SDK MCP server (`createSdkMcpServer`, `tool`). They call `InternalTools`, whose HTTP adapter posts to memory's `/internal/memory.search` and `/internal/memory.insert` on the `exec` network. |
| Built-in tools | None: `tools: []`, `allowedTools` lists the two internal tools, `permissionMode: 'dontAsk'`, `settingSources: []`, `strictMcpConfig: true`, `persistSession: false`.                                                                                                                                  |
| Limits         | Turns (`maxTurns`, default 8), cost (`maxBudgetUsd`, default 0.5), wall time (runner timeout, default 120 s). Defaults live in `services/memory/src/main.ts`; the service sends turns and budget in `WorkerInput.limits`.                                                                             |
| Output schema  | Passed to the SDK as `outputFormat: { type: 'json_schema', schema }`, generated from the tool's data schema in `packages/contracts` (`RecallDataSchema`, `RememberDataSchema`).                                                                                                                       |
| Validation     | The worker does not decide trust. The service parses stdout with `WorkerOutputSchema` then validates `data` with the tool schema; a violation is `WORKER_OUTPUT_INVALID` and the run is recorded as failed.                                                                                           |
| Cost           | `total_cost_usd` and `usage` from the SDK result message become `Result.cost`.                                                                                                                                                                                                                        |
| Secrets        | None in the container. `ANTHROPIC_BASE_URL` targets the secrets broker.                                                                                                                                                                                                                               |

SDK facts used (checked in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`): `query`, `tool`, `createSdkMcpServer`, `Options.tools`, `Options.allowedTools`, `Options.maxTurns`, `Options.maxBudgetUsd`, `Options.outputFormat`, `Options.permissionMode`, `Options.settingSources`, `Options.persistSession`, `Options.strictMcpConfig`, `Options.env`, and the `result` message (`subtype`, `structured_output`, `total_cost_usd`, `usage`).

Not covered by the default test suite: a live run of `sdk-agent.ts` against Anthropic (it needs the broker and a key). Tests inject a scripted `AgentPort`.

### Adding a worker agent for a new service

1. Define the tool schemas in `packages/contracts` (and add the tool to `TOOLS` with its owner).
2. Create `services/<name>/` with the same layers and a `worker/` directory.
3. Give the agent only the internal tools it needs; keep the built-in tools off.
4. Register tests per [testing.md](testing.md) and add the service to `compose.yaml` and `test/infra/compose.test.ts`.

## Review subagents (`.claude/agents/`)

Format per the Claude Code subagent documentation: Markdown with YAML frontmatter (`name`, `description`, `tools`, `model`) and the system prompt as body. They are read-only reviewers used by `/review-pr` and by the Claude review workflow.

| Subagent                | Checks                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `architecture-reviewer` | Layers, component boundaries, composition root, guard integrity (`npm run arch`).                       |
| `test-reviewer`         | Every brick has unit tests per layer, port contract tests, an end-to-end case when on the call path.    |
| `security-reviewer`     | Secrets, worker and network isolation, database access outside `data`, gateway auth path, supply chain. |

`/review-pr` (`.claude/commands/review-pr.md`) is modelled on the command of the same name in `anthropics/claude-code-action`: it delegates to the three subagents, keeps only noteworthy feedback and posts inline comments. `CLAUDE.md` ("What the review must refuse") is the bar they apply.
