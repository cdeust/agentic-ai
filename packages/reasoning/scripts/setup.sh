#!/usr/bin/env bash
# setup.sh — Install zetetic-team-subagents into ~/.claude/
#
# Copies agents, skills, and commands to the Claude Code user directory.
# Merges hooks into plugin.json, applies per-agent model overrides, checks
# external dependencies, tracks installed files via manifest for idempotent
# updates and clean uninstall.
#
# Usage:
#   bash scripts/setup.sh [install|update|uninstall|configure] [--dry-run] [--verbose]

set -euo pipefail

# ── Path resolution ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$SCRIPT_DIR")}"
CLAUDE_DIR="${HOME}/.claude"
MANIFEST="${CLAUDE_DIR}/.zetetic-manifest"
VERSION_FILE="${CLAUDE_DIR}/.zetetic-version"
MODEL_CONFIG="${CLAUDE_DIR}/zetetic-agent-models.json"
BACKUP_SUFFIX=".zetetic-backup"

# ── Colors ─────────────────────────────────────────────────────────────
TEAL="\033[1;38;2;127;187;179m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
WHITE="\033[38;2;224;224;224m"
BOLD="\033[1m"
NC="\033[0m"

ok()   { echo -e "  ${GREEN}[ok]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[!!]${NC} $1"; }
fail() { echo -e "  ${RED}[FAIL]${NC} $1"; exit 1; }
info() { echo -e "  $1"; }
step() { echo ""; echo -e "${TEAL}───${NC} ${WHITE}${BOLD}$1${NC} ${TEAL}───${NC}"; }

# ── Flag parsing ───────────────────────────────────────────────────────
ACTION="install"
DRY_RUN=false
VERBOSE=false

ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=true ;;
    --verbose)   VERBOSE=true ;;
    --uninstall) ACTION="uninstall" ;;
    -h|--help)
      sed -n '2,/^$/s/^# \?//p' "$0"
      exit 0 ;;
    *) ARGS+=("$arg") ;;
  esac
done
[[ ${#ARGS[@]} -gt 0 ]] && ACTION="${ARGS[0]}"

[[ "$VERBOSE" == true ]] && set -x

# ── Helpers ────────────────────────────────────────────────────────────
sha_cmd() {
  if command -v shasum &>/dev/null; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum &>/dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    echo "no-checksum"
  fi
}

read_version() {
  local pjson="$PLUGIN_ROOT/.claude-plugin/plugin.json"
  [[ ! -f "$pjson" ]] && pjson="$PLUGIN_ROOT/plugin.json"
  [[ ! -f "$pjson" ]] && { echo "unknown"; return; }
  if command -v jq &>/dev/null; then
    jq -r '.version // "unknown"' "$pjson"
  else
    grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$pjson" | head -1 | sed 's/.*"\([^"]*\)"/\1/'
  fi
}

# ── Model override resolution ──────────────────────────────────────────
# Reads ~/.claude/zetetic-agent-models.json and resolves the model for an agent.
# Config schema:
#   { "agents": { "engineer": "sonnet", ... },
#     "patterns": [ { "glob": "genius/*", "model": "sonnet" } ] }
# Precedence: exact match > first glob match > default from frontmatter
MODEL_OVERRIDES_LOADED=false
MODEL_OVERRIDES_AGENTS=""
MODEL_OVERRIDES_PATTERNS=""

load_model_overrides() {
  [[ "$MODEL_OVERRIDES_LOADED" == true ]] && return
  MODEL_OVERRIDES_LOADED=true
  [[ ! -f "$MODEL_CONFIG" ]] && return
  command -v python3 &>/dev/null || { warn "python3 required for model overrides — skipping"; return; }

  if ! python3 -c "import json; json.load(open('$MODEL_CONFIG'))" 2>/dev/null; then
    warn "Invalid JSON in $MODEL_CONFIG — skipping model overrides"
    return
  fi

  MODEL_OVERRIDES_AGENTS=$(python3 -c "
import json
with open('$MODEL_CONFIG') as f: d = json.load(f)
for name, model in d.get('agents', {}).items():
    print(f'{name}={model}')
" 2>/dev/null || true)

  MODEL_OVERRIDES_PATTERNS=$(python3 -c "
import json
with open('$MODEL_CONFIG') as f: d = json.load(f)
for p in d.get('patterns', []):
    print(f\"{p['glob']}={p['model']}\")
" 2>/dev/null || true)

  local ac pc
  ac=$(echo "$MODEL_OVERRIDES_AGENTS" | grep -c '=' 2>/dev/null || echo "0")
  pc=$(echo "$MODEL_OVERRIDES_PATTERNS" | grep -c '=' 2>/dev/null || echo "0")
  [[ "$ac" -gt 0 || "$pc" -gt 0 ]] && ok "Model overrides loaded: $ac agents, $pc patterns"
}

resolve_model() {
  local agent_name="$1" default_model="$2"
  [[ -z "$MODEL_OVERRIDES_AGENTS" && -z "$MODEL_OVERRIDES_PATTERNS" ]] && { echo "$default_model"; return; }

  # Exact match
  local exact
  exact=$(echo "$MODEL_OVERRIDES_AGENTS" | grep "^${agent_name}=" 2>/dev/null | head -1 | cut -d= -f2)
  [[ -n "$exact" ]] && { echo "$exact"; return; }

  # Glob patterns — first match wins
  while IFS= read -r pattern_line; do
    [[ -z "$pattern_line" ]] && continue
    local glob_pattern="${pattern_line%%=*}"
    local glob_model="${pattern_line#*=}"
    # shellcheck disable=SC2254
    case "$agent_name" in
      $glob_pattern) echo "$glob_model"; return ;;
    esac
  done <<< "$MODEL_OVERRIDES_PATTERNS"

  echo "$default_model"
}

# ── Uninstall ──────────────────────────────────────────────────────────
do_uninstall() {
  step "Uninstalling Zetetic Team Subagents"

  if [[ ! -f "$MANIFEST" ]]; then
    warn "No manifest found — nothing to uninstall"
    warn "If files remain, remove manually from ~/.claude/agents/, skills/, commands/"
    return
  fi

  local removed=0 skipped=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local expected_hash="${line%%  *}"
    local rel_path="${line#*  }"
    local target="${CLAUDE_DIR}/${rel_path}"
    [[ ! -f "$target" ]] && continue

    # Skip user-modified files
    local current_hash; current_hash="$(sha_cmd "$target")"
    if [[ "$expected_hash" != "no-checksum" && "$current_hash" != "$expected_hash" ]]; then
      if [[ "$DRY_RUN" == true ]]; then
        info "Would keep (user-modified): $rel_path"
      else
        warn "Keeping user-modified: $rel_path"
        skipped=$((skipped + 1))
      fi
      continue
    fi

    if [[ "$DRY_RUN" == true ]]; then
      info "Would remove: $rel_path"
    else
      rm "$target"
    fi
    removed=$((removed + 1))
  done < "$MANIFEST"

  # Clean empty directories
  if [[ "$DRY_RUN" == false ]]; then
    find "${CLAUDE_DIR}/agents/genius" -type d -empty -delete 2>/dev/null || true
    for subdir in skills commands hooks tools rules; do
      find "${CLAUDE_DIR}/${subdir}" -mindepth 1 -type d -empty -delete 2>/dev/null || true
    done

    # Restore backups
    local restored=0
    while IFS= read -r backup; do
      [[ -z "$backup" ]] && continue
      local original="${backup%${BACKUP_SUFFIX}}"
      mv "$backup" "$original" && restored=$((restored + 1))
    done < <(find "$CLAUDE_DIR" -name "*${BACKUP_SUFFIX}" -type f 2>/dev/null)
    [[ "$restored" -gt 0 ]] && ok "Restored $restored user-modified files from backup"

    # Remove hooks from plugin.json
    local plugin_json="$PLUGIN_ROOT/.claude-plugin/plugin.json"
    if [[ -f "$plugin_json" ]] && command -v python3 &>/dev/null && grep -q '"hooks"' "$plugin_json"; then
      python3 -c "
import json
with open('$plugin_json') as f: d = json.load(f)
d.pop('hooks', None)
with open('$plugin_json', 'w') as f: json.dump(d, f, indent=2); f.write('\n')
" 2>/dev/null && ok "Removed hooks from plugin.json" || warn "Could not clean plugin.json"
    fi

    rm -f "$MANIFEST" "$VERSION_FILE"
  fi

  ok "Removed $removed files"
  [[ "$skipped" -gt 0 ]] && ok "Kept $skipped user-modified files"
  echo ""
  echo -e "${GREEN}Uninstall complete.${NC} Restart Claude Code to deactivate."
}

# ── Configure (model overrides) ────────────────────────────────────────
do_configure() {
  step "Model override configuration"

  if [[ -f "$MODEL_CONFIG" ]]; then
    info "Existing config: $MODEL_CONFIG"
    echo ""
    cat "$MODEL_CONFIG"
    echo ""
    echo -e "  Edit this file directly, then run ${CYAN}$0 update${NC} to apply."
    echo "  To reset: rm $MODEL_CONFIG && $0 configure"
    return
  fi

  cat > "$MODEL_CONFIG" <<'CONF'
{
  "//": "Zetetic Agent Model Overrides — survives plugin updates",
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
  echo "    - 97 genius agents → sonnet (via glob pattern)"
  echo "    - architect, orchestrator, research-scientist, paper-writer, reviewer-academic → opus"
  echo "    - Other team agents → sonnet"
  echo ""
  echo -e "  Edit to customize, then run ${CYAN}$0 update${NC} to apply."
  echo "  Config is yours — plugin updates never overwrite it."
}

# ── Install dispatch guards ────────────────────────────────────────────
case "$ACTION" in
  uninstall)  do_uninstall; exit 0 ;;
  configure)  do_configure; exit 0 ;;
  install|update) ;;
  *) echo "usage: $0 [install|update|uninstall|configure] [--dry-run] [--verbose]" >&2; exit 2 ;;
esac

# ── Banner ─────────────────────────────────────────────────────────────
PLUGIN_VERSION="$(read_version)"

echo ""
echo -e "${TEAL}  ███████╗███████╗████████╗███████╗████████╗██╗ ██████╗${NC}"
echo -e "${TEAL}  ╚══███╔╝██╔════╝╚══██╔══╝██╔════╝╚══██╔══╝██║██╔════╝${NC}"
echo -e "${TEAL}    ███╔╝ █████╗     ██║   █████╗     ██║   ██║██║     ${NC}"
echo -e "${TEAL}   ███╔╝  ██╔══╝     ██║   ██╔══╝     ██║   ██║██║     ${NC}"
echo -e "${TEAL}  ███████╗███████╗   ██║   ███████╗   ██║   ██║╚██████╗${NC}"
echo -e "${TEAL}  ╚══════╝╚══════╝   ╚═╝   ╚══════╝   ╚═╝   ╚═╝ ╚═════╝${NC}"
echo ""
echo -e "  ${WHITE}${BOLD}Setup v${PLUGIN_VERSION}${NC}"
echo ""

# ── Prerequisites ──────────────────────────────────────────────────────
step "Prerequisites"

[[ -d "$CLAUDE_DIR" ]] || fail "~/.claude/ does not exist. Is Claude Code installed?"
[[ -w "$CLAUDE_DIR" ]] || fail "~/.claude/ is not writable"
ok "Claude Code directory exists"

# ── Version gate ───────────────────────────────────────────────────────
step "Version check"

if [[ -f "$VERSION_FILE" ]]; then
  INSTALLED_VERSION="$(cat "$VERSION_FILE")"
  if [[ "$INSTALLED_VERSION" == "$PLUGIN_VERSION" ]]; then
    ok "Version $PLUGIN_VERSION already installed — reinstalling"
  elif [[ "$INSTALLED_VERSION" > "$PLUGIN_VERSION" ]]; then
    warn "Downgrade detected: $INSTALLED_VERSION → $PLUGIN_VERSION"
  else
    ok "Upgrading: $INSTALLED_VERSION → $PLUGIN_VERSION"
  fi
else
  ok "Fresh install: $PLUGIN_VERSION"
fi

# ── Load model overrides ───────────────────────────────────────────────
step "Model overrides"
load_model_overrides
[[ "$MODEL_OVERRIDES_LOADED" == true && -z "$MODEL_OVERRIDES_AGENTS$MODEL_OVERRIDES_PATTERNS" ]] && \
  info "No overrides — using agent frontmatter defaults (run '$0 configure' to customize)"

# ── Stage files to temp directory (atomic copy) ────────────────────────
step "Staging"

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

manifest_lines=()
count_agents=0
count_genius=0
count_skills=0
count_commands=0
count_hooks=0
count_tools=0
count_rules=0
count_overridden=0

# Stage a file (with optional model override for agent .md files)
stage_file() {
  local src="$1" rel_dest="$2" apply_models="${3:-false}"
  local dest_dir; dest_dir="$(dirname "$STAGING/$rel_dest")"
  mkdir -p "$dest_dir"

  if [[ "$apply_models" == true ]] && [[ "$src" == *.md ]]; then
    local agent_rel="${rel_dest#agents/}"
    local agent_name="${agent_rel%.md}"
    local current_model target_model
    current_model=$(sed -n '/^---$/,/^---$/{ /^model:/s/^model: *//p; }' "$src" 2>/dev/null | head -1)
    [[ -z "$current_model" ]] && current_model="opus"
    target_model=$(resolve_model "$agent_name" "$current_model")

    if [[ "$target_model" != "$current_model" ]]; then
      sed "s/^model: .*/model: $target_model/" "$src" > "$STAGING/$rel_dest"
      count_overridden=$((count_overridden + 1))
    else
      cp "$src" "$STAGING/$rel_dest"
    fi
  else
    cp "$src" "$STAGING/$rel_dest"
  fi

  local checksum; checksum="$(sha_cmd "$STAGING/$rel_dest")"
  manifest_lines+=("${checksum}  ${rel_dest}")
}

# Stage a directory tree (files + subdirectories)
stage_tree() {
  local src_root="$1" dest_prefix="$2" apply_models="${3:-false}"
  local counter_var="$4"
  local count=0

  [[ -d "$src_root" ]] || return

  # Top-level files
  for f in "$src_root"/*.md "$src_root"/*.sh "$src_root"/*.json; do
    [[ -f "$f" ]] || continue
    stage_file "$f" "${dest_prefix}/$(basename "$f")" "$apply_models"
    count=$((count + 1))
  done

  # Subdirectories
  for dir in "$src_root"/*/; do
    [[ -d "$dir" ]] || continue
    local dname; dname="$(basename "$dir")"
    for f in "$dir"*.md "$dir"*.sh "$dir"*.json; do
      [[ -f "$f" ]] || continue
      stage_file "$f" "${dest_prefix}/${dname}/$(basename "$f")" "$apply_models"
      count=$((count + 1))
    done
  done

  printf -v "$counter_var" "%d" "$count"
}

stage_tree "$PLUGIN_ROOT/agents"   "agents"   true  _n; count_agents=$_n
# Count genius agents separately for reporting
count_genius=$(find "$STAGING/agents/genius" -name "*.md" -not -name "INDEX.md" 2>/dev/null | wc -l | tr -d ' ')
count_agents=$((count_agents - count_genius))

stage_tree "$PLUGIN_ROOT/skills"   "skills"   false _n; count_skills=$_n
stage_tree "$PLUGIN_ROOT/commands" "commands" false _n; count_commands=$_n
stage_tree "$PLUGIN_ROOT/hooks"    "hooks"    false _n; count_hooks=$_n
stage_tree "$PLUGIN_ROOT/tools"    "tools"    false _n; count_tools=$_n
stage_tree "$PLUGIN_ROOT/rules"    "rules"    false _n; count_rules=$_n

ok "Staged: $count_agents team + $count_genius genius agents, $count_skills skills, $count_commands commands, $count_hooks hooks, $count_tools tools, $count_rules rules"
[[ "$count_overridden" -gt 0 ]] && ok "Applied $count_overridden model overrides"

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo -e "${YELLOW}Dry run — would install ${#manifest_lines[@]} files to $CLAUDE_DIR${NC}"
  exit 0
fi

# ── Install from staging (backup user-modified files) ──────────────────
step "Installing"

backed_up=0 copied=0 failed=0
for entry in "${manifest_lines[@]}"; do
  rel_path="${entry#*  }"
  target="${CLAUDE_DIR}/${rel_path}"
  target_dir="$(dirname "$target")"
  mkdir -p "$target_dir"

  # Back up user-modified files before overwriting
  if [[ -f "$target" && -f "$MANIFEST" ]]; then
    old_hash=$(grep "  ${rel_path}$" "$MANIFEST" 2>/dev/null | head -1 | cut -d' ' -f1 || true)
    if [[ -n "$old_hash" && "$old_hash" != "no-checksum" ]]; then
      current_hash="$(sha_cmd "$target")"
      if [[ "$current_hash" != "$old_hash" ]]; then
        cp "$target" "${target}${BACKUP_SUFFIX}"
        backed_up=$((backed_up + 1))
      fi
    fi
  fi

  if cp "$STAGING/$rel_path" "$target" 2>/dev/null; then
    copied=$((copied + 1))
    # Preserve executable bit on .sh files
    [[ "$rel_path" == *.sh ]] && chmod +x "$target"
  else
    warn "Failed to copy: $rel_path"
    failed=$((failed + 1))
  fi
done

ok "Copied $copied files to $CLAUDE_DIR"
[[ "$backed_up" -gt 0 ]] && ok "Backed up $backed_up user-modified files (*.zetetic-backup)"
[[ "$failed" -gt 0 ]] && warn "$failed files failed to copy"

# ── Merge hooks into plugin.json (Cortex-style) ────────────────────────
step "Hooks → plugin.json"

plugin_json="$PLUGIN_ROOT/.claude-plugin/plugin.json"
hooks_json="$PLUGIN_ROOT/hooks/hooks.json"

if [[ ! -f "$plugin_json" ]]; then
  warn ".claude-plugin/plugin.json not found — skipping hook merge"
elif [[ ! -f "$hooks_json" ]]; then
  warn "hooks/hooks.json not found — skipping hook merge"
elif ! command -v python3 &>/dev/null; then
  warn "python3 not found — skipping hook merge"
else
  existing_count=$(python3 -c "
import json
with open('$plugin_json') as f: d = json.load(f)
hooks = d.get('hooks', {})
print(sum(len(v) for v in hooks.values()) if isinstance(hooks, dict) else 0)
" 2>/dev/null || echo "0")

  if [[ "$existing_count" -gt 0 ]]; then
    ok "Hooks already in plugin.json ($existing_count entries) — skipping"
  else
    cp "$plugin_json" "${plugin_json}.bak.$$"
    if python3 -c "
import json
with open('$plugin_json') as f: plugin = json.load(f)
with open('$hooks_json') as f: hooks_data = json.load(f)
# hooks.json already uses correct nested schema; just add timeouts where missing
plugin_hooks = {}
for event, entries in hooks_data.get('hooks', {}).items():
    for entry in entries:
        for h in entry.get('hooks', []):
            if 'timeout' not in h:
                h['timeout'] = 10 if event in ('SessionStart', 'Stop', 'SessionEnd') else 5
    plugin_hooks[event] = entries
plugin['hooks'] = plugin_hooks
with open('$plugin_json', 'w') as f: json.dump(plugin, f, indent=2); f.write('\n')
print(sum(len(v) for v in plugin_hooks.values()))
" 2>/dev/null; then
      rm -f "${plugin_json}.bak.$$"
      ok "Merged hooks into plugin.json"
    else
      mv "${plugin_json}.bak.$$" "$plugin_json"
      warn "Hook merge failed — plugin.json restored"
    fi
  fi
fi

# ── Remove orphans from previous installs ──────────────────────────────
step "Orphan cleanup"

orphan_count=0
if [[ -f "$MANIFEST" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    old_path="${line#*  }"
    found=false
    for entry in "${manifest_lines[@]}"; do
      if [[ "${entry#*  }" == "$old_path" ]]; then found=true; break; fi
    done
    if [[ "$found" == false ]]; then
      target="${CLAUDE_DIR}/${old_path}"
      [[ -f "$target" ]] && rm "$target" && orphan_count=$((orphan_count + 1))
    fi
  done < "$MANIFEST"
fi

if [[ "$orphan_count" -gt 0 ]]; then
  ok "Removed $orphan_count orphaned files from previous install"
  find "${CLAUDE_DIR}/agents/genius" -type d -empty -delete 2>/dev/null || true
  for subdir in skills commands hooks tools; do
    find "${CLAUDE_DIR}/${subdir}" -mindepth 1 -type d -empty -delete 2>/dev/null || true
  done
else
  ok "No orphans found"
fi

# ── Write manifest and version ─────────────────────────────────────────
step "Manifest"

if printf '%s\n' "${manifest_lines[@]}" > "$MANIFEST" 2>/dev/null; then
  ok "Manifest written (${#manifest_lines[@]} files tracked)"
else
  warn "Failed to write manifest — uninstall will not work"
fi

if echo "$PLUGIN_VERSION" > "$VERSION_FILE" 2>/dev/null; then
  ok "Version $PLUGIN_VERSION recorded"
else
  warn "Failed to write version file"
fi

# ── Dependency checks (optional) ───────────────────────────────────────
step "Dependencies (optional)"

check_dep() {
  local name="$1" cmd="$2" hint="$3" required="${4:-no}"
  if command -v "$cmd" &>/dev/null; then
    ok "$name"
  elif [[ "$required" == "yes" ]]; then
    fail "$name not found. Install: $hint"
  else
    warn "$name not found (optional). Install: $hint"
  fi
}

check_py_dep() {
  local name="$1" module="$2" hint="$3"
  python3 -c "import $module" 2>/dev/null && ok "$name" || warn "$name not found (optional). Install: $hint"
}

check_dep "jq"       "jq"       "brew install jq"                           "yes"
check_dep "git"      "git"      "brew install git / xcode-select --install" "yes"
check_dep "python3"  "python3"  "brew install python"                       "yes"
check_dep "Docker"   "docker"   "brew install --cask docker"
check_dep "fswatch"  "fswatch"  "brew install fswatch"
check_dep "entr"     "entr"     "brew install entr"
check_dep "Pandoc"   "pandoc"   "brew install pandoc"
check_dep "pdflatex" "pdflatex" "brew install --cask mactex-no-gui"
check_dep "py-spy"   "py-spy"   "pip install py-spy"
check_py_dep "mlx-lm" "mlx_lm" "pip install mlx-lm"

# ── Self-test ──────────────────────────────────────────────────────────
step "Verification"

genius_count=$(find "$CLAUDE_DIR/agents/genius" -name "*.md" -not -name "INDEX.md" 2>/dev/null | wc -l | tr -d ' ')
[[ "$genius_count" -ge 90 ]] && ok "Genius agents accessible ($genius_count agents)" || warn "Expected ~97 genius agents, found $genius_count"

team_count=$(find "$CLAUDE_DIR/agents" -maxdepth 1 -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
ok "Team agents installed ($team_count)"

skill_count=$(find "$CLAUDE_DIR/skills" -name "*.md" -not -name "_*" 2>/dev/null | wc -l | tr -d ' ')
ok "Skills installed ($skill_count)"

cmd_count=$(find "$CLAUDE_DIR/commands" -name "*.md" -not -name "_*" 2>/dev/null | wc -l | tr -d ' ')
ok "Commands installed ($cmd_count)"

rules_count=$(find "$CLAUDE_DIR/rules" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
ok "Rules installed ($rules_count)"

# ── Summary ────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Zetetic Team Subagents v${PLUGIN_VERSION} setup complete!${NC}"
echo ""
echo "  $count_agents team + $count_genius genius agents → ~/.claude/agents/"
echo "  $count_skills skills                              → ~/.claude/skills/"
echo "  $count_commands commands                            → ~/.claude/commands/"
echo "  $count_hooks hooks                                → ~/.claude/hooks/"
echo "  $count_tools tools                                → ~/.claude/tools/"
echo "  $count_rules rules                                → ~/.claude/rules/"
[[ "$count_overridden" -gt 0 ]] && echo "  $count_overridden model overrides applied from ~/.claude/zetetic-agent-models.json"
echo ""
echo "  Next steps:"
echo "    1. Restart Claude Code to activate"
echo -e "    2. Configure models:  ${CYAN}$0 configure${NC}"
echo -e "    3. Update:            ${CYAN}$0 update${NC}"
echo -e "    4. Uninstall:         ${CYAN}$0 uninstall${NC}"
echo ""
