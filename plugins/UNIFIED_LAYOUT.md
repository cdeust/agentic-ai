# Unified Plugin Layout

This document specifies the proposed monorepo layout for the unified
`cdeust/agentic-ai` plugin system, with rationale for every structural decision.

---

## Directory Tree

```
.claude-plugin/
├── marketplace.json              # ONE marketplace; lists all 4 plugins
├── memory/
│   ├── plugin.json               # cortex → memory plugin manifest (v3.14.8)
│   ├── .mcp.json                 # cortex MCP server registration (fixed)
│   └── README.md                 # what cortex does; dependencies; first-run
├── codebase/
│   ├── plugin.json               # automatised-pipeline → codebase plugin (v0.0.4)
│   ├── .mcp.json                 # ai-architect MCP server (Rust binary)
│   └── README.md
├── reasoning/
│   ├── plugin.json               # zetetic-team-subagents → reasoning plugin (v2.13.1)
│   ├── .mcp.json                 # zetetic memory MCP (optional, fixed)
│   └── README.md
└── prd/
    ├── plugin.json               # prd-spec-generator → prd plugin (v0.3.0)
    ├── .mcp.json                 # prd-gen MCP server (Node.js)
    └── README.md

skills/
├── memory/                       # cortex skills (14 .md files, symlinked/copied from Cortex)
├── codebase/                     # (empty at migration; no skills in source)
├── reasoning/                    # zetetic skills (61 .md files across 7 categories)
└── prd/                          # (empty at migration; no skills in source)

commands/
├── memory/                       # cortex commands (1: methodology.md)
├── codebase/                     # (empty at migration)
├── reasoning/                    # zetetic commands (25 .md files across 9 categories)
└── prd/                          # prd commands (1: generate-prd.md)
```

---

## Structural Decisions

### Decision 1: Sub-directory per plugin inside `.claude-plugin/`

**Why:** The Claude Code plugin system resolves `"mcpServers": "./.mcp.json"` relative to the
plugin.json file's location. By placing each `plugin.json` inside its own sub-directory
(`.claude-plugin/memory/plugin.json`), the relative `./.mcp.json` resolves to
`.claude-plugin/memory/.mcp.json` — a clean, isolated MCP config per plugin.

The alternative (all four `plugin.json` files in `.claude-plugin/` root) creates naming
collisions: only one file named `plugin.json` can exist in a directory.

### Decision 2: One `marketplace.json` in `.claude-plugin/` root

**Why:** The marketplace is the discovery surface — the file a user's Claude Code reads when
they do `/plugin marketplace add cdeust/agentic-ai`. It must be a single file at the
`.claude-plugin/` root. It lists all four plugins with their individual versions.

Users browse the marketplace, decide which plugins to install, then issue separate
`/plugin install` commands. This is the discovery/install separation.

### Decision 3: Skills and commands in top-level `skills/` and `commands/`

**Why:** Claude Code's skill resolution (`/skill run <name>`) looks in `skills/` at
the repository root and in `~/.claude/skills/`. Placing skills under
`.claude-plugin/memory/skills/` would require a non-standard resolution path.

The flat `skills/` and `commands/` at repo root with per-plugin sub-directories
keeps Claude Code's standard resolution while making ownership clear.

### Decision 4: Independent versioning per plugin

**Why:** The four plugins have vastly different maturity levels (memory at 3.14.8,
reasoning at 2.13.1, prd at 0.3.0, codebase at 0.0.4). Bundling them under a single
version number would either freeze the fast-moving ones or artificially inflate the
slow ones. Independent versioning lets each plugin release on its own cadence.

**Trade-off:** The marketplace.json top-level `metadata.version` loses meaning when
plugins version independently. We use a calendar-versioned `metadata.version`
(e.g., `"2026.04"`) for the marketplace itself, independent of plugin versions.

---

## Install Model: Individual Installs via Shared Marketplace

### Chosen model

```
/plugin marketplace add cdeust/agentic-ai
/plugin install memory@agentic-ai
/plugin install codebase@agentic-ai
/plugin install reasoning@agentic-ai
/plugin install prd@agentic-ai
```

### Why not a single bundle install?

A bundle install (`/plugin install agentic-ai-bundle`) would:

1. **Hide the value proposition of each plugin.** A user who only needs PRD generation
   should not be required to start a Cortex PostgreSQL database. Forced bundling
   increases friction for partial adopters.

2. **Couple version lifecycles.** If codebase releases a breaking change requiring a
   Rust recompile, the bundle version must bump, forcing users to re-install all four
   plugins even if only one changed.

3. **Prevent selective enablement.** Some environments (sandboxed, Cowork mode) cannot
   run the Rust binary. A bundle prevents those users from installing the reasoning and
   prd plugins independently.

4. **Model Reader mismatch.** The first-time user's interpretive move when seeing
   `agentic-ai-bundle` is: "I must need all of this." A first-time user who only wants
   smart memory will install 200MB of Rust toolchain they don't need. This is a
   discoverable semiotic failure — the artifact (bundle) encodes "you need all of this"
   when the producer intention is "take what you need."

### Why individual installs are correct

1. **Maps to user jobs-to-be-done.** Memory, codebase intelligence, reasoning agents,
   and PRD generation are four distinct jobs. Users arrive with one job in mind.

2. **Correct closed/open classification per plugin.**
   - `memory` and `prd` are closed (single-purpose, single workflow).
   - `reasoning` is open (97 patterns, user selects).
   - `codebase` is closed-for-input, open-for-output.
   The install experience must preserve this distinction.

3. **Marketplace lookup is the discovery mechanism.** After
   `/plugin marketplace add cdeust/agentic-ai`, the user sees all four plugins with
   descriptions. They self-select. This is the Model Reader's natural interpretive move.

### Shared marketplace but optional individual installs

The marketplace.json still lists all four, providing cross-discovery:
a user installing `memory` will see `codebase`, `reasoning`, and `prd` in the marketplace
listing and can optionally install them. This is the "open work" property: the marketplace
permits multiple valid uses without constraining to a single path.

---

## `${CLAUDE_PLUGIN_ROOT}` Usage Rules

Every `.mcp.json` in this unified layout follows exactly one pattern:

**For Python/Node.js launchers:** Use `bash -c` wrapper so the shell expands `${CLAUDE_PLUGIN_ROOT}`:
```json
{
  "command": "bash",
  "args": ["-c", "exec node \"${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js\""]
}
```

**For Rust binaries with fallback to cargo:** Same bash-wrapper:
```json
{
  "command": "bash",
  "args": ["-c", "BIN=\"${CLAUDE_PLUGIN_ROOT}/target/release/ai-architect-mcp\" && if [ -x \"$BIN\" ]; then exec \"$BIN\"; else exec cargo run --quiet --release --manifest-path \"${CLAUDE_PLUGIN_ROOT}/Cargo.toml\"; fi"]
}
```

**Never:**
- `${CLAUDE_PLUGIN_ROOT:-fallback}` — the `:-fallback` part is NOT substituted by Claude Code
- `${ANY_OTHER_VAR:-fallback}` in `env` values — same reason
- Relative paths in `args` without `${CLAUDE_PLUGIN_ROOT}` anchor

**Root cause (commit cf85cfc, cdeust/automatised-pipeline, 2026-04-25):**
Claude Code's MCP arg template substitution matches only the literal pattern `${CLAUDE_PLUGIN_ROOT}`.
The regex does not cover compound parameter expansion syntax (`${VAR:-default}`, `${VAR:+alt}`, etc.).
When a compound expression is present, the entire literal string is passed to the process,
which then evaluates under the shell where `CLAUDE_PLUGIN_ROOT` may be unset. With `:-$PWD`,
bash falls back to the project's current working directory — not the plugin install directory.
Silent wrong path; no error; tools silently fail to find the plugin's files.

---

## Plugin-to-logical-name Mapping

| Source repo name | Unified logical name | Rationale |
|---|---|---|
| `cortex` | `memory` | User mental model: "I want Claude to remember." Not "I want cortex." |
| `automatised-pipeline` | `codebase` | User mental model: "I want codebase analysis." Not "I want a Rust pipeline." |
| `zetetic-team-subagents` | `reasoning` | User mental model: "I want better reasoning." Not "I want zetetic agents." |
| `prd-spec-generator` | `prd` | User mental model: "I want to generate PRDs." Direct match. |

The logical names are the install handles. The source repo names appear in `repository` and
`homepage` fields for provenance. This separation applies the Model Reader principle: the
artifact (install command) is designed for the user's job-to-be-done vocabulary, not the
developer's internal naming convention.
