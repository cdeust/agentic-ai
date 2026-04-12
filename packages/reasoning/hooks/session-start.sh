#!/usr/bin/env bash
# session-start.sh — Load context at session start
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TOOLS="$REPO_ROOT/tools"

# --- Colors (true color RGB) ---
TEAL="\033[1;38;2;127;187;179m"
ASH="\033[38;2;133;146;137m"
STONE="\033[38;2;157;169;160m"
DIM="\033[2m"
BOLD="\033[1m"
RESET="\033[0m"

# --- Banner ---
echo ""
echo -e "${TEAL}  ███████╗███████╗████████╗███████╗████████╗██╗ ██████╗${RESET}"
echo -e "${TEAL}  ╚══███╔╝██╔════╝╚══██╔══╝██╔════╝╚══██╔══╝██║██╔════╝${RESET}"
echo -e "${TEAL}    ███╔╝ █████╗     ██║   █████╗     ██║   ██║██║     ${RESET}"
echo -e "${TEAL}   ███╔╝  ██╔══╝     ██║   ██╔══╝     ██║   ██║██║     ${RESET}"
echo -e "${TEAL}  ███████╗███████╗   ██║   ███████╗   ██║   ██║╚██████╗${RESET}"
echo -e "${TEAL}  ╚══════╝╚══════╝   ╚═╝   ╚══════╝   ╚═╝   ╚═╝ ╚═════╝${RESET}"
echo ""
echo -e "${ASH}  A G E N T S${RESET}"
echo ""
echo -e "${STONE}  97 reasoning patterns  ·  63 skills  ·  14 hooks  ·  17 tools${RESET}"
echo ""
echo -e "${DIM}  Pearl ── Peirce ── Feynman ── Toulmin ── Cochrane${RESET}"
echo -e "${DIM}  causal    abductive  integrity   argument   evidence${RESET}"
echo -e "${DIM}  graphs    hypotheses checks      structure  synthesis${RESET}"
echo ""
echo -e "${DIM}  every claim cites its source · every commit is checked${RESET}"
echo -e "${DIM}  every agent says \"I don't know\" when it doesn't${RESET}"
echo ""

# --- Status ---
echo -e "${STONE}  ◆ Repository${RESET}"
echo "  Branch: $(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo 'unknown')"
echo "  Uncommitted: $(git -C "$REPO_ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ') files"
echo "  Last commit: $(git -C "$REPO_ROOT" log --oneline -1 2>/dev/null || echo 'none')"
echo ""

echo -e "${STONE}  ◆ Difficulty Books${RESET}"
"$TOOLS/difficulty-book-manager.sh" status 2>/dev/null || echo "  (none)"
echo ""

echo -e "${STONE}  ◆ Agent Worktrees${RESET}"
"$TOOLS/worktree-manager.sh" list 2>/dev/null || echo "  (none)"
echo ""

echo -e "${STONE}  ◆ Session Cache${RESET}"
"$TOOLS/session-store.sh" load 2>/dev/null || echo "  (no cached session)"
echo ""

echo -e "${ASH}  Reminder: call query_methodology for cognitive profile, recall for Cortex context.${RESET}"
