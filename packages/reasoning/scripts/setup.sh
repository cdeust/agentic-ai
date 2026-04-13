#!/usr/bin/env bash
# setup.sh — Install, update, or uninstall zetetic-team-subagents into Claude Code CLI
#
# Usage:
#   scripts/setup.sh [install]       Install all components to ~/.claude/
#   scripts/setup.sh update          Update from plugin source (preserves user edits)
#   scripts/setup.sh uninstall       Remove all installed components
#   scripts/setup.sh configure       Create/show model override config
#   scripts/setup.sh --dry-run       Show what would be done without doing it
#   scripts/setup.sh --verbose       Show detailed progress
#   scripts/setup.sh --help          Show this help
#
# Components installed:
#   agents/      → ~/.claude/agents/          (116 files, full frontmatter power)
#   skills/      → ~/.claude/skills/          (skill .md files)
#   commands/    → ~/.claude/commands/        (command .md files)
#   tools/       → ~/.claude/tools/           (tool .sh files)
#   hooks        → merged into plugin.json   (14 hook scripts)
#
# Manifest: ~/.claude/.zetetic-manifest.json tracks installed files for clean updates/removal.

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────
VERSION="2.2.0"
MANIFEST_FILE="$HOME/.claude/.zetetic-manifest.json"
MODEL_CONFIG="$HOME/.claude/zetetic-agent-models.json"
BACKUP_SUFFIX=".zetetic-backup"
NAMESPACE="zetetic"  # prefix for collision avoidance

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}  [ok]${NC} $1"; }
warn() { echo -e "${YELLOW}  [!!]${NC} $1"; }
fail() { echo -e "${RED}  [FAIL]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}  [..]${NC} $1"; }
step() { echo -e "\n${CYAN}${BOLD}=== $1 ===${NC}"; }
dry()  { echo -e "${YELLOW}  [dry]${NC} $1"; }
verb() { [[ "$VERBOSE" == true ]] && echo -e "       $1" || true; }

# ── Flags ──────────────────────────────────────────────────────────────
DRY_RUN=false
VERBOSE=false
ACTION="${1:-install}"

# Parse flags (can appear anywhere)
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=true ;;
    --verbose)  VERBOSE=true ;;
    --help|-h)
      sed -n '2,/^$/{ s/^# \?//; p; }' "$0"
      exit 0 ;;
    --uninstall) ACTION="uninstall" ;;
    *)          ARGS+=("$arg") ;;
  esac
done
[[ ${#ARGS[@]} -gt 0 ]] && ACTION="${ARGS[0]}"

# ── Plugin root discovery ──────────────────────────────────────────────
discover_plugin_root() {
  # 1. CLAUDE_PLUGIN_ROOT env var (set by Claude Code at runtime)
  if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]] && [[ -d "$CLAUDE_PLUGIN_ROOT/agents" ]]; then
    echo "$CLAUDE_PLUGIN_ROOT"
    return
  fi

  # 2. Script's own location (when run from the repo)
  local script_dir; script_dir="$(cd "$(dirname "$0")" && pwd)"
  local repo_dir; repo_dir="$(dirname "$script_dir")"
  if [[ -d "$repo_dir/agents" ]] && [[ -d "$repo_dir/skills" ]]; then
    echo "$repo_dir"
    return
  fi

  # 3. Walk the plugin cache
  local cache_dir="$HOME/.claude/plugins/cache"
  if [[ -d "$cache_dir" ]]; then
    local found
    found=$(find "$cache_dir" -maxdepth 4 -name "plugin.json" -path "*zetetic*" 2>/dev/null | head -1)
    if [[ -n "$found" ]]; then
      local plugin_dir; plugin_dir="$(dirname "$(dirname "$found")")"
      if [[ -d "$plugin_dir/agents" ]]; then
        echo "$plugin_dir"
        return
      fi
    fi
  fi

  # 4. Git root
  local git_root
  git_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -n "$git_root" ]] && [[ -d "$git_root/agents" ]]; then
    echo "$git_root"
    return
  fi

  return 1
}

PLUGIN_ROOT="$(discover_plugin_root)" || fail "Cannot find plugin root. Run from the repo or set CLAUDE_PLUGIN_ROOT."
verb "Plugin root: $PLUGIN_ROOT"

# ── Manifest helpers ───────────────────────────────────────────────────
sha256_file() {
  if command -v shasum &>/dev/null; then
    shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1
  elif command -v sha256sum &>/dev/null; then
    sha256sum "$1" 2>/dev/null | cut -d' ' -f1
  else
    # Fallback: use file size + mod time as pseudo-hash
    stat -f "%z-%m" "$1" 2>/dev/null || stat -c "%s-%Y" "$1" 2>/dev/null
  fi
}

load_manifest() {
  if [[ -f "$MANIFEST_FILE" ]]; then
    cat "$MANIFEST_FILE"
  else
    echo '{"version":"","files":[]}'
  fi
}

save_manifest() {
  local version="$1" files_json="$2"
  [[ "$DRY_RUN" == true ]] && return
  mkdir -p "$(dirname "$MANIFEST_FILE")"
  cat > "$MANIFEST_FILE" <<MANIFEST
{
  "version": "$version",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "plugin_root": "$PLUGIN_ROOT",
  "files": $files_json
}
MANIFEST
}

# ── Model override resolution ─────────────────────────────────────────
# Reads ~/.claude/zetetic-agent-models.json and resolves the model for an agent.
# Config schema:
#   { "agents": { "engineer": "sonnet", ... }, "patterns": [ { "glob": "genius/*", "model": "sonnet" } ] }
# Precedence: exact match > first glob match > default from frontmatter
MODEL_OVERRIDES_LOADED=false
MODEL_OVERRIDES_AGENTS=""
MODEL_OVERRIDES_PATTERNS=""

load_model_overrides() {
  [[ "$MODEL_OVERRIDES_LOADED" == true ]] && return
  MODEL_OVERRIDES_LOADED=true

  if [[ ! -f "$MODEL_CONFIG" ]]; then
    return
  fi

  if ! command -v python3 &>/dev/null; then
    warn "python3 not found — model overrides require python3. Skipping."
    return
  fi

  # Validate config
  if ! python3 -c "import json; json.load(open('$MODEL_CONFIG'))" 2>/dev/null; then
    warn "Invalid JSON in $MODEL_CONFIG — skipping model overrides."
    return
  fi

  MODEL_OVERRIDES_AGENTS=$(python3 -c "
import json
with open('$MODEL_CONFIG') as f:
    d = json.load(f)
for name, model in d.get('agents', {}).items():
    print(f'{name}={model}')
" 2>/dev/null || true)

  MODEL_OVERRIDES_PATTERNS=$(python3 -c "
import json
with open('$MODEL_CONFIG') as f:
    d = json.load(f)
for p in d.get('patterns', []):
    print(f\"{p['glob']}={p['model']}\")
" 2>/dev/null || true)

  if [[ -n "$MODEL_OVERRIDES_AGENTS" || -n "$MODEL_OVERRIDES_PATTERNS" ]]; then
    local agent_count; agent_count=$(echo "$MODEL_OVERRIDES_AGENTS" | grep -c '=' 2>/dev/null || echo "0")
    local pattern_count; pattern_count=$(echo "$MODEL_OVERRIDES_PATTERNS" | grep -c '=' 2>/dev/null || echo "0")
    ok "Model overrides loaded: $agent_count agents, $pattern_count patterns"
  fi
}

resolve_model() {
  local agent_rel_path="$1" default_model="$2"

  # No config → use default
  [[ -z "$MODEL_OVERRIDES_AGENTS" && -z "$MODEL_OVERRIDES_PATTERNS" ]] && { echo "$default_model"; return; }

  # Agent name: strip .md, use relative path with / → / for genius/fermi style
  local agent_name="${agent_rel_path%.md}"

  # 1. Exact match in agents dict
  local exact
  exact=$(echo "$MODEL_OVERRIDES_AGENTS" | grep "^${agent_name}=" 2>/dev/null | head -1 | cut -d= -f2)
  if [[ -n "$exact" ]]; then
    echo "$exact"
    return
  fi

  # 2. Glob patterns — first match wins
  while IFS= read -r pattern_line; do
    [[ -z "$pattern_line" ]] && continue
    local glob_pattern="${pattern_line%%=*}"
    local glob_model="${pattern_line#*=}"
    # Convert glob to bash pattern: * → anything
    # shellcheck disable=SC2254
    case "$agent_name" in
      $glob_pattern) echo "$glob_model"; return ;;
    esac
  done <<< "$MODEL_OVERRIDES_PATTERNS"

  # 3. No match → default
  echo "$default_model"
}

# Apply model override to a .md file during copy
# Writes to dst with model: line rewritten if override exists
copy_file_with_model() {
  local src="$1" dst="$2" agent_rel_path="$3"
  local dst_dir; dst_dir="$(dirname "$dst")"

  # Extract current model from frontmatter
  local current_model
  current_model=$(sed -n '/^---$/,/^---$/{ /^model:/s/^model: *//p; }' "$src" 2>/dev/null | head -1)
  [[ -z "$current_model" ]] && current_model="opus"

  # Resolve target model
  local target_model
  target_model=$(resolve_model "$agent_rel_path" "$current_model")

  if [[ "$DRY_RUN" == true ]]; then
    if [[ "$target_model" != "$current_model" ]]; then
      dry "copy + model override ($current_model → $target_model): $(basename "$src")"
    else
      dry "copy: $src → $dst"
    fi
    return
  fi

  mkdir -p "$dst_dir"

  # Backup user-modified files (same logic as copy_file)
  if [[ -f "$dst" ]]; then
    local src_hash; src_hash="$(sha256_file "$src")"
    local dst_hash; dst_hash="$(sha256_file "$dst")"
    if [[ "$src_hash" != "$dst_hash" ]]; then
      local manifest_hash=""
      if [[ -f "$MANIFEST_FILE" ]]; then
        manifest_hash=$(grep -o "\"$dst\"[^}]*\"hash\":\"[^\"]*\"" "$MANIFEST_FILE" 2>/dev/null | grep -o '"hash":"[^"]*"' | cut -d'"' -f4 || true)
      fi
      if [[ -n "$manifest_hash" ]] && [[ "$manifest_hash" != "$dst_hash" ]]; then
        cp "$dst" "${dst}${BACKUP_SUFFIX}"
        warn "backed up user-modified: $(basename "$dst")"
      fi
    fi
  fi

  # Copy with model rewrite if needed
  if [[ "$target_model" != "$current_model" ]]; then
    sed "s/^model: .*/model: $target_model/" "$src" > "$dst"
    verb "  $(basename "$src") (model: $current_model → $target_model)"
  else
    cp "$src" "$dst"
    verb "  $(basename "$src")"
  fi
}

# ── File copy with safety ─────────────────────────────────────────────
copy_file() {
  local src="$1" dst="$2"
  local dst_dir; dst_dir="$(dirname "$dst")"

  if [[ "$DRY_RUN" == true ]]; then
    dry "copy: $src → $dst"
    return
  fi

  mkdir -p "$dst_dir"

  # If destination exists and was user-modified, back it up
  if [[ -f "$dst" ]]; then
    local src_hash; src_hash="$(sha256_file "$src")"
    local dst_hash; dst_hash="$(sha256_file "$dst")"
    if [[ "$src_hash" != "$dst_hash" ]]; then
      # Check if it's our file or user-modified
      local manifest_hash=""
      if [[ -f "$MANIFEST_FILE" ]]; then
        manifest_hash=$(grep -o "\"$dst\"[^}]*\"hash\":\"[^\"]*\"" "$MANIFEST_FILE" 2>/dev/null | grep -o '"hash":"[^"]*"' | cut -d'"' -f4 || true)
      fi
      if [[ -n "$manifest_hash" ]] && [[ "$manifest_hash" != "$dst_hash" ]]; then
        # User modified this file — back it up
        cp "$dst" "${dst}${BACKUP_SUFFIX}"
        warn "backed up user-modified: $(basename "$dst")"
      fi
    fi
  fi

  cp "$src" "$dst"
  verb "  $(basename "$src")"
}

# ── Install component directory ───────────────────────────────────────
# Copies files from $src_dir to $dst_dir, tracking in manifest entries
# Pass "model" as $5 to apply model overrides on .md files (agents only)
install_component() {
  local component="$1" src_dir="$2" dst_dir="$3" pattern="${4:-*.md}" apply_models="${5:-}"
  local count=0 overridden=0

  step "$component"

  if [[ ! -d "$src_dir" ]]; then
    warn "Source not found: $src_dir — skipping"
    return
  fi

  # Find all matching files recursively
  while IFS= read -r src_file; do
    [[ ! -f "$src_file" ]] && continue

    # Compute relative path from src_dir
    local rel_path="${src_file#$src_dir/}"
    local dst_file="$dst_dir/$rel_path"

    # For agents: apply model overrides before copying
    if [[ "$apply_models" == "model" ]] && [[ "$src_file" == *.md ]]; then
      copy_file_with_model "$src_file" "$dst_file" "$rel_path"
      # Hash the destination (may differ from source due to model rewrite)
      local hash
      if [[ "$DRY_RUN" != true ]] && [[ -f "$dst_file" ]]; then
        hash="$(sha256_file "$dst_file")"
      else
        hash="$(sha256_file "$src_file")"
      fi
      # Track if model was overridden
      local src_model; src_model=$(sed -n '/^---$/,/^---$/{ /^model:/s/^model: *//p; }' "$src_file" 2>/dev/null | head -1)
      local dst_model; dst_model=$(resolve_model "${rel_path%.md}" "${src_model:-opus}")
      [[ "$dst_model" != "${src_model:-opus}" ]] && overridden=$((overridden + 1))
    else
      copy_file "$src_file" "$dst_file"
      local hash; hash="$(sha256_file "$src_file")"
    fi

    # Append to manifest entries
    MANIFEST_ENTRIES+=("{\"path\":\"$dst_file\",\"hash\":\"$hash\",\"component\":\"$component\",\"source\":\"$rel_path\"}")
    count=$((count + 1))
  done < <(find "$src_dir" -name "$pattern" -type f 2>/dev/null | sort)

  # Also handle .sh files for tools/hooks
  if [[ "$pattern" == "*.md" ]] && [[ -n "$(find "$src_dir" -name "*.sh" -type f 2>/dev/null | head -1)" ]]; then
    while IFS= read -r src_file; do
      local rel_path="${src_file#$src_dir/}"
      local dst_file="$dst_dir/$rel_path"
      local hash; hash="$(sha256_file "$src_file")"

      copy_file "$src_file" "$dst_file"
      [[ "$DRY_RUN" != true ]] && chmod +x "$dst_file"

      MANIFEST_ENTRIES+=("{\"path\":\"$dst_file\",\"hash\":\"$hash\",\"component\":\"$component\",\"source\":\"$rel_path\"}")
      count=$((count + 1))
    done < <(find "$src_dir" -name "*.sh" -type f 2>/dev/null | sort)
  fi

  # Handle .json files
  if [[ -n "$(find "$src_dir" -name "*.json" -type f 2>/dev/null | head -1)" ]]; then
    while IFS= read -r src_file; do
      local rel_path="${src_file#$src_dir/}"
      local dst_file="$dst_dir/$rel_path"
      local hash; hash="$(sha256_file "$src_file")"

      copy_file "$src_file" "$dst_file"

      MANIFEST_ENTRIES+=("{\"path\":\"$dst_file\",\"hash\":\"$hash\",\"component\":\"$component\",\"source\":\"$rel_path\"}")
      count=$((count + 1))
    done < <(find "$src_dir" -name "*.json" -type f 2>/dev/null | sort)
  fi

  if [[ "$overridden" -gt 0 ]]; then
    ok "$count files → $dst_dir ($overridden model overrides applied)"
  else
    ok "$count files → $dst_dir"
  fi
}

# ── Merge hooks into plugin.json ──────────────────────────────────────
merge_hooks_to_plugin_json() {
  step "Hooks → plugin.json"

  local plugin_json="$PLUGIN_ROOT/.claude-plugin/plugin.json"
  local hooks_json="$PLUGIN_ROOT/hooks/hooks.json"

  if [[ ! -f "$hooks_json" ]]; then
    warn "hooks/hooks.json not found — skipping hook merge"
    return
  fi

  if [[ ! -f "$plugin_json" ]]; then
    warn ".claude-plugin/plugin.json not found — skipping hook merge"
    return
  fi

  # Check if hooks already present in plugin.json
  if grep -q '"hooks"' "$plugin_json" 2>/dev/null; then
    # Check if it's our hooks or empty
    local existing_hook_count
    existing_hook_count=$(python3 -c "
import json, sys
with open('$plugin_json') as f:
    d = json.load(f)
hooks = d.get('hooks', {})
count = sum(len(v) for v in hooks.values()) if isinstance(hooks, dict) else 0
print(count)
" 2>/dev/null || echo "0")

    if [[ "$existing_hook_count" -gt 0 ]]; then
      ok "Hooks already in plugin.json ($existing_hook_count entries) — skipping"
      return
    fi
  fi

  if [[ "$DRY_RUN" == true ]]; then
    dry "would merge hooks/hooks.json → .claude-plugin/plugin.json"
    return
  fi

  # Backup plugin.json
  cp "$plugin_json" "${plugin_json}.bak.$$"

  # Merge hooks into plugin.json using Python (safe JSON handling)
  python3 -c "
import json

with open('$plugin_json') as f:
    plugin = json.load(f)
with open('$hooks_json') as f:
    hooks_data = json.load(f)

# hooks.json already uses the correct nested schema (matcher + hooks array)
# Just add timeouts where missing
plugin_hooks = {}
for event, entries in hooks_data.get('hooks', {}).items():
    for entry in entries:
        for h in entry.get('hooks', []):
            if 'timeout' not in h:
                h['timeout'] = 10 if event in ('SessionStart', 'Stop', 'SessionEnd') else 5
    plugin_hooks[event] = entries

plugin['hooks'] = plugin_hooks

with open('$plugin_json', 'w') as f:
    json.dump(plugin, f, indent=2)
    f.write('\n')

print(f'Merged {sum(len(v) for v in plugin_hooks.values())} hook entries')
" 2>/dev/null && {
    rm -f "${plugin_json}.bak.$$"
    ok "Hooks merged into plugin.json"
  } || {
    # Restore on failure
    mv "${plugin_json}.bak.$$" "$plugin_json"
    warn "Hook merge failed — plugin.json restored from backup"
  }
}

# ── Orphan cleanup ────────────────────────────────────────────────────
cleanup_orphans() {
  local old_manifest="$1"
  local removed=0

  # Get list of old files
  local old_files
  old_files=$(echo "$old_manifest" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for f in data.get('files', []):
    print(f['path'])
" 2>/dev/null || true)

  [[ -z "$old_files" ]] && return

  while IFS= read -r old_file; do
    [[ -z "$old_file" ]] && continue
    # Check if this file is in the new manifest
    local is_current=false
    for entry in "${MANIFEST_ENTRIES[@]}"; do
      if echo "$entry" | grep -q "\"$old_file\""; then
        is_current=true
        break
      fi
    done
    if [[ "$is_current" == false ]] && [[ -f "$old_file" ]]; then
      if [[ "$DRY_RUN" == true ]]; then
        dry "would remove orphan: $old_file"
      else
        rm -f "$old_file"
        verb "  removed orphan: $(basename "$old_file")"
        removed=$((removed + 1))
      fi
    fi
  done <<< "$old_files"

  [[ "$removed" -gt 0 ]] && ok "Removed $removed orphaned files"
}

# ── Interrupt handler ─────────────────────────────────────────────────
cleanup_on_interrupt() {
  local plugin_json="$PLUGIN_ROOT/.claude-plugin/plugin.json"
  # Restore plugin.json backup if exists
  local backup
  backup=$(ls "${plugin_json}.bak."* 2>/dev/null | head -1)
  if [[ -n "$backup" ]]; then
    mv "$backup" "$plugin_json"
    warn "Interrupted — restored plugin.json from backup"
  fi
  exit 130
}
trap cleanup_on_interrupt INT TERM

# ── INSTALL ───────────────────────────────────────────────────────────
do_install() {
  echo -e "\n${BOLD}Zetetic Team Subagents — Setup v${VERSION}${NC}"
  echo -e "Source: ${PLUGIN_ROOT}\n"

  # Pre-flight checks
  step "Pre-flight checks"
  command -v bash &>/dev/null && ok "bash" || fail "bash not found"
  command -v python3 &>/dev/null && ok "python3" || warn "python3 not found (hook merge may fail)"

  # Check if Claude Code dir exists
  if [[ ! -d "$HOME/.claude" ]]; then
    if [[ "$DRY_RUN" == true ]]; then
      dry "would create ~/.claude/"
    else
      mkdir -p "$HOME/.claude"
    fi
  fi
  ok "~/.claude/ exists"

  # Version gate
  local old_manifest; old_manifest="$(load_manifest)"
  local old_version
  old_version=$(echo "$old_manifest" | python3 -c "import json,sys; print(json.load(sys.stdin).get('version',''))" 2>/dev/null || echo "")

  if [[ -n "$old_version" ]]; then
    if [[ "$old_version" == "$VERSION" ]]; then
      info "Reinstalling v${VERSION} (same version)"
    elif [[ "$old_version" < "$VERSION" ]]; then
      info "Upgrading: v${old_version} → v${VERSION}"
    else
      info "Downgrading: v${old_version} → v${VERSION}"
    fi
  else
    info "Fresh install: v${VERSION}"
  fi

  # Collect manifest entries
  MANIFEST_ENTRIES=()

  # Load model overrides config (if present)
  load_model_overrides

  # Install components
  install_component "Agents" \
    "$PLUGIN_ROOT/agents" \
    "$HOME/.claude/agents" \
    "*.md" \
    "model"

  install_component "Skills" \
    "$PLUGIN_ROOT/skills" \
    "$HOME/.claude/skills"

  install_component "Commands" \
    "$PLUGIN_ROOT/commands" \
    "$HOME/.claude/commands"

  install_component "Tools" \
    "$PLUGIN_ROOT/tools" \
    "$HOME/.claude/tools"

  install_component "Hooks" \
    "$PLUGIN_ROOT/hooks" \
    "$HOME/.claude/hooks"

  # Merge hooks into plugin.json
  merge_hooks_to_plugin_json

  # Orphan cleanup (remove files from old version that no longer exist)
  if [[ -n "$old_version" ]]; then
    step "Orphan cleanup"
    cleanup_orphans "$old_manifest"
  fi

  # Save manifest
  step "Manifest"
  local files_json
  files_json="[$(IFS=,; echo "${MANIFEST_ENTRIES[*]}")]"
  save_manifest "$VERSION" "$files_json"
  ok "Saved manifest: ${#MANIFEST_ENTRIES[@]} files tracked"

  # Self-test
  step "Verification"
  local check_dirs=(
    "$HOME/.claude/agents/genius"
    "$HOME/.claude/skills"
    "$HOME/.claude/commands"
    "$HOME/.claude/tools"
  )
  local all_ok=true
  for d in "${check_dirs[@]}"; do
    if [[ -d "$d" ]]; then
      local count; count=$(find "$d" -type f 2>/dev/null | wc -l | tr -d ' ')
      ok "$d ($count files)"
    else
      warn "$d — missing"
      all_ok=false
    fi
  done

  # Check a few key files
  local key_files=(
    "$HOME/.claude/agents/genius/INDEX.md"
    "$HOME/.claude/agents/engineer.md"
    "$HOME/.claude/agents/orchestrator.md"
    "$HOME/.claude/tools/genius-invoker.sh"
  )
  for f in "${key_files[@]}"; do
    if [[ -f "$f" ]]; then
      verb "  $(basename "$f") present"
    else
      warn "Missing key file: $f"
      all_ok=false
    fi
  done

  # Summary
  echo ""
  if [[ "$DRY_RUN" == true ]]; then
    echo -e "${YELLOW}${BOLD}Dry run complete — no files were modified.${NC}"
  elif [[ "$all_ok" == true ]]; then
    echo -e "${GREEN}${BOLD}Zetetic setup complete!${NC} (${#MANIFEST_ENTRIES[@]} files installed)"
    echo ""
    echo "  Restart Claude Code to activate."
    echo "  Agents are now at ~/.claude/agents/ with full frontmatter power."
    echo ""
    echo "  To configure models: $0 configure"
    echo "  To update:           $0 update"
    echo "  To uninstall:        $0 uninstall"
  else
    echo -e "${YELLOW}${BOLD}Setup completed with warnings.${NC}"
    echo "  Some components may be missing. Check the warnings above."
  fi
}

# ── UNINSTALL ─────────────────────────────────────────────────────────
do_uninstall() {
  echo -e "\n${BOLD}Zetetic Team Subagents — Uninstall${NC}\n"

  if [[ ! -f "$MANIFEST_FILE" ]]; then
    warn "No manifest found at $MANIFEST_FILE — nothing to uninstall."
    echo "  If files were installed manually, remove them from ~/.claude/ yourself."
    exit 0
  fi

  local manifest; manifest="$(cat "$MANIFEST_FILE")"
  local file_count
  file_count=$(echo "$manifest" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('files',[])))" 2>/dev/null || echo "0")

  step "Removing $file_count installed files"

  local removed=0 skipped=0
  local files
  files=$(echo "$manifest" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for f in data.get('files', []):
    print(f['path'] + '|' + f.get('hash', ''))
" 2>/dev/null || true)

  while IFS='|' read -r filepath filehash; do
    [[ -z "$filepath" ]] && continue

    if [[ ! -f "$filepath" ]]; then
      verb "  already gone: $(basename "$filepath")"
      continue
    fi

    # Check if user modified the file
    local current_hash; current_hash="$(sha256_file "$filepath")"
    if [[ -n "$filehash" ]] && [[ "$current_hash" != "$filehash" ]]; then
      if [[ "$DRY_RUN" == true ]]; then
        dry "would skip user-modified: $filepath"
      else
        warn "Keeping user-modified: $(basename "$filepath")"
        skipped=$((skipped + 1))
      fi
      continue
    fi

    if [[ "$DRY_RUN" == true ]]; then
      dry "would remove: $filepath"
    else
      rm -f "$filepath"
      verb "  removed: $(basename "$filepath")"
    fi
    removed=$((removed + 1))
  done <<< "$files"

  # Remove empty directories we created
  local dirs_to_check=(
    "$HOME/.claude/agents/genius"
    "$HOME/.claude/skills/analysis"
    "$HOME/.claude/skills/architecture"
    "$HOME/.claude/skills/compose"
    "$HOME/.claude/skills/engineering"
    "$HOME/.claude/skills/genius"
    "$HOME/.claude/skills/research"
    "$HOME/.claude/skills/zetetic"
    "$HOME/.claude/commands/agent"
    "$HOME/.claude/commands/genius"
    "$HOME/.claude/commands/git"
    "$HOME/.claude/commands/quality"
    "$HOME/.claude/commands/research"
    "$HOME/.claude/commands/session"
    "$HOME/.claude/commands/skill"
    "$HOME/.claude/commands/zetetic"
  )
  for d in "${dirs_to_check[@]}"; do
    if [[ -d "$d" ]] && [[ -z "$(ls -A "$d" 2>/dev/null)" ]]; then
      [[ "$DRY_RUN" != true ]] && rmdir "$d" 2>/dev/null || true
      verb "  removed empty dir: $d"
    fi
  done

  # Restore backups
  step "Restoring backups"
  local restored=0
  while IFS= read -r backup; do
    [[ -z "$backup" ]] && continue
    local original="${backup%${BACKUP_SUFFIX}}"
    if [[ "$DRY_RUN" == true ]]; then
      dry "would restore: $backup → $original"
    else
      mv "$backup" "$original"
      ok "Restored: $(basename "$original")"
    fi
    restored=$((restored + 1))
  done < <(find "$HOME/.claude" -name "*${BACKUP_SUFFIX}" -type f 2>/dev/null)
  [[ "$restored" -eq 0 ]] && ok "No backups to restore"

  # Remove manifest
  if [[ "$DRY_RUN" != true ]]; then
    rm -f "$MANIFEST_FILE"
  fi

  # Remove hooks from plugin.json
  step "Cleaning plugin.json hooks"
  local plugin_json="$PLUGIN_ROOT/.claude-plugin/plugin.json"
  if [[ -f "$plugin_json" ]] && grep -q '"hooks"' "$plugin_json" 2>/dev/null; then
    if [[ "$DRY_RUN" == true ]]; then
      dry "would remove hooks from plugin.json"
    else
      python3 -c "
import json
with open('$plugin_json') as f:
    data = json.load(f)
data.pop('hooks', None)
with open('$plugin_json', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
" 2>/dev/null && ok "Hooks removed from plugin.json" || warn "Could not clean plugin.json hooks"
    fi
  else
    ok "No hooks in plugin.json"
  fi

  # Summary
  echo ""
  if [[ "$DRY_RUN" == true ]]; then
    echo -e "${YELLOW}${BOLD}Dry run complete — no files were modified.${NC}"
  else
    echo -e "${GREEN}${BOLD}Uninstall complete.${NC}"
    echo "  Removed: $removed files"
    [[ "$skipped" -gt 0 ]] && echo "  Kept:    $skipped user-modified files"
    [[ "$restored" -gt 0 ]] && echo "  Restored: $restored backups"
    echo ""
    echo "  Restart Claude Code to deactivate."
  fi
}

# ── CONFIGURE (model overrides) ───────────────────────────────────────
do_configure() {
  echo -e "\n${BOLD}Zetetic Team Subagents — Model Configuration${NC}\n"

  if [[ -f "$MODEL_CONFIG" ]]; then
    info "Existing config: $MODEL_CONFIG"
    echo ""
    cat "$MODEL_CONFIG"
    echo ""
    echo -e "  Edit this file directly, then run ${CYAN}$0 update${NC} to apply."
    echo ""
    echo "  To reset: rm $MODEL_CONFIG && $0 configure"
    return
  fi

  step "Creating model override config"

  # Generate default config with sensible defaults
  cat > "$MODEL_CONFIG" <<'CONF'
{
  "//": "Zetetic Agent Model Overrides",
  "//note": "Configure which model each agent uses. Survives plugin updates.",
  "//models": "opus (most capable), sonnet (balanced), haiku (fastest/cheapest)",
  "//precedence": "per-call > this config > agent frontmatter default",

  "patterns": [
    { "glob": "genius/*", "model": "sonnet" }
  ],

  "agents": {
    "architect": "opus",
    "engineer": "sonnet",
    "code-reviewer": "sonnet",
    "test-engineer": "sonnet",
    "frontend-engineer": "sonnet",
    "dba": "sonnet",
    "devops-engineer": "sonnet",
    "data-scientist": "sonnet",
    "experiment-runner": "sonnet",
    "mlops": "sonnet",
    "latex-engineer": "sonnet",
    "security-auditor": "sonnet",
    "ux-designer": "sonnet",
    "research-scientist": "opus",
    "paper-writer": "opus",
    "reviewer-academic": "opus",
    "professor": "sonnet",
    "orchestrator": "opus"
  }
}
CONF

  ok "Created $MODEL_CONFIG"
  echo ""
  echo "  Default config:"
  echo "    - 97 genius agents → sonnet (via pattern)"
  echo "    - architect, orchestrator, research-scientist, paper-writer, reviewer-academic → opus"
  echo "    - All other team agents → sonnet"
  echo ""
  echo "  Edit the file to customize, then run:"
  echo -e "    ${CYAN}$0 update${NC}"
  echo ""
  echo "  This config is yours — it will never be overwritten by plugin updates."
}

# ── Main dispatch ─────────────────────────────────────────────────────
case "$ACTION" in
  install)   do_install ;;
  update)    do_install ;;  # update is just install with version diffing
  uninstall) do_uninstall ;;
  configure) do_configure ;;
  *)
    echo "usage: $0 [install|update|uninstall|configure] [--dry-run] [--verbose]" >&2
    exit 2
    ;;
esac
