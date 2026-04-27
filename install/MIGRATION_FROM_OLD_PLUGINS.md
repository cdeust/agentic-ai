# Migration from Old Individual Plugins to Unified agentic-ai

This guide is for users who currently have any of the four source-repo plugins installed:
- `cdeust/Cortex` (installed as `cortex`)
- `cdeust/automatised-pipeline` (installed as `automatised-pipeline`)
- `cdeust/zetetic-team-subagents` (installed as `zetetic-team-subagents`)
- `cdeust/prd-spec-generator` (installed as `prd-spec-generator`)

---

## State Inventory: What Survives Migration

Before uninstalling, understand what state each plugin holds and whether it persists
through the migration.

| Plugin | Persistent state | Location | Survives migration? |
|---|---|---|---|
| memory (Cortex) | PostgreSQL DB: memories, cognitive profiles, wiki | `postgresql://localhost:5432/cortex` | YES — DB is external to the plugin |
| memory (Cortex) | SQLite fallback DB | `~/.cortex/cortex.db` (or configured path) | YES — file is external to the plugin |
| codebase (automatised-pipeline) | LadybugDB property graph | Embedded in plugin's `data/` directory | RISK — if stored inside the plugin install dir, it is LOST on uninstall. Verify the `LADYBUG_DB_PATH` env var. |
| reasoning (zetetic) | `~/.claude/` agents, skills, commands, hooks | `~/.claude/agents/`, `~/.claude/skills/`, etc. | Must be re-installed by postInstall of the new plugin |
| prd (prd-spec-generator) | EvidenceRepository SQLite DB | `${CLAUDE_PLUGIN_ROOT}/.prd-gen/evidence.db` | RISK — stored inside plugin install dir; may be LOST on uninstall |

### Action required BEFORE uninstalling:

**For `codebase`:**
```bash
# Check where LadybugDB is stored
/plugin list automatised-pipeline
# Or inspect the plugin config
cat $(claude-plugin-path automatised-pipeline)/.mcp.json
# If data/ is inside the plugin dir, back it up:
cp -r <plugin-root>/data/ ~/ladybugdb-backup/
```

**For `prd`:**
```bash
# Back up the EvidenceRepository
cp <plugin-root>/.prd-gen/evidence.db ~/prd-evidence-backup.db
```

---

## Migration Steps

### Step 1: Back up state (see above)

### Step 2: Uninstall old plugins

```
/plugin uninstall cortex
/plugin uninstall automatised-pipeline
/plugin uninstall zetetic-team-subagents
/plugin uninstall prd-spec-generator
```

Then remove the old marketplaces:
```
/plugin marketplace remove cdeust/Cortex
/plugin marketplace remove cdeust/automatised-pipeline
/plugin marketplace remove cdeust/zetetic-team-subagents
/plugin marketplace remove cdeust/prd-spec-generator
```

**Note:** Uninstalling `zetetic-team-subagents` removes the plugin files but does NOT
remove the files copied to `~/.claude/` by the postInstall script. The new `reasoning`
plugin's postInstall will overwrite them, so no manual cleanup is needed — but if you
want a clean state:
```bash
rm -rf ~/.claude/agents/
rm -rf ~/.claude/skills/
rm -rf ~/.claude/commands/
# Keep ~/.claude/CLAUDE.md and settings.json
```

### Step 3: Clean up hooks from settings.json (if applicable)

If any old hook commands reference the old plugin install path, they will fail after
uninstall. Check `~/.claude/settings.json` for stale hook entries referencing old paths.

### Step 4: Add the unified marketplace

```
/plugin marketplace add cdeust/agentic-ai
```

### Step 5: Install unified plugins

```
/plugin install memory@agentic-ai
/plugin install codebase@agentic-ai
/plugin install reasoning@agentic-ai
/plugin install prd@agentic-ai
```

### Step 6: Restore state (if backed up)

**For prd EvidenceRepository:**
```bash
# Find the new plugin install root
PLUGIN_ROOT=$(claude-plugin-path prd)
mkdir -p "$PLUGIN_ROOT/.prd-gen/"
cp ~/prd-evidence-backup.db "$PLUGIN_ROOT/.prd-gen/evidence.db"
```

**For codebase LadybugDB (if it was inside the old plugin dir):**
```bash
PLUGIN_ROOT=$(claude-plugin-path codebase)
mkdir -p "$PLUGIN_ROOT/data/"
cp -r ~/ladybugdb-backup/ "$PLUGIN_ROOT/data/"
```

**For memory (Cortex):**
- PostgreSQL mode: No action needed. The DB is at `postgresql://localhost:5432/cortex`.
  The new plugin connects to the same database automatically.
- SQLite mode: Verify the `DATABASE_URL` or `CORTEX_SQLITE_PATH` in the new
  `.claude-plugin/memory/.mcp.json` points to the same SQLite file as before.

### Step 7: Reload and verify

```
/reload-plugins
```

Run the first-run verification for each plugin (see `INSTALL_FLOW.md §Step 5`).

---

## Source Repo Archival

When the migration is complete and the unified plugin is stable, the four source repos
will carry an archival notice. Each repo's `README.md` will include:

```markdown
> **Archived**: This plugin has been consolidated into [cdeust/agentic-ai](https://github.com/cdeust/agentic-ai).
> Install the unified plugin instead: `/plugin marketplace add cdeust/agentic-ai && /plugin install <name>@agentic-ai`
> This repository is preserved for reference and will receive security fixes only.
```

The `gh repo archive` command will be applied to each source repo:
```bash
gh repo archive cdeust/Cortex
gh repo archive cdeust/automatised-pipeline
gh repo archive cdeust/zetetic-team-subagents
gh repo archive cdeust/prd-spec-generator
```

**Important:** Archiving makes a repo read-only on GitHub but does not delete it. Existing
installs of the old plugins will continue to work until the user migrates. The archived
repos are a "closed artifact" in semiotic terms: they constrain the user to a single path
(migrate to the unified plugin) by making clear no new development occurs here.

**Archival timeline:** Only after the unified plugin has been in production use for at
least one week without regressions. Do not archive prematurely.

---

## Rollback

If the migration fails and you need to revert:

1. Uninstall the unified plugins:
   ```
   /plugin uninstall memory@agentic-ai
   /plugin uninstall codebase@agentic-ai
   /plugin uninstall reasoning@agentic-ai
   /plugin uninstall prd@agentic-ai
   /plugin marketplace remove cdeust/agentic-ai
   ```

2. Re-install the original plugins from the (not-yet-archived) source repos:
   ```
   /plugin marketplace add cdeust/Cortex
   /plugin install cortex
   /plugin marketplace add cdeust/automatised-pipeline
   /plugin install automatised-pipeline
   /plugin marketplace add cdeust/zetetic-team-subagents
   /plugin install zetetic-team-subagents
   /plugin marketplace add cdeust/prd-spec-generator
   /plugin install prd-spec-generator
   ```

3. Restore state from backups (reverse of Step 6 above).

**This rollback path is only available before the source repos are archived.**
