# Worktree Isolation Protocol — 2026-05-04

**Auditor**: Lamport (causality / invariant lens)
**Branch**: `audit/lamport-worktree-isolation-2026-05-04`
**Status**: binding protocol — supersedes any informal worktree usage

---

## §1 The Bug Pattern — Happens-Before Trace

The shared worktree at `/Users/cdeust/Developments/agentic-ai` is a **single global mutable state**: one working-tree directory, one index, one `HEAD`. When N agents operate in it concurrently, their event sequences interleave on the same filesystem. There is no causal barrier between agents.

Concrete trace — agents A (Eng-1, pg_stores) and B (Eng-3, recall_pipeline):

```
A₁: git checkout port/exact-cortex-eng1-pg-stores   # A's HEAD moves
B₁: git checkout port/exact-cortex-eng3-recall-core  # B's HEAD moves — RACES A₁
A₂: edit packages/memory/src/pg_store_*.ts           # A writes unstaged files
B₂: edit packages/memory/src/recall/recall_pipeline.ts  # B writes unstaged files
                                                         # SAME working-tree directory
A₃: git add ... && git commit                        # A's commit sees B₂'s files as
                                                     # unstaged WIP — pnpm typecheck
                                                     # at pre-commit [3/3] runs tsc
                                                     # across the ENTIRE workspace,
                                                     # which includes B₂'s broken file.
A₄: pre-commit: [3/3] typecheck → FAIL              # Failure reason: B's WIP
```

The causal issue is precise: `A₃ → A₄` is supposed to depend only on `A₁ ∪ A₂`. But because the working tree is shared, `B₂ ∥ A₃` (B's write and A's commit are causally unrelated — no happens-before edge between them), yet A's pre-commit hook observes B's files anyway. The filesystem provides no isolation boundary.

**Why `git stash` does not fix this**: `git stash push` saves the stashing agent's own unstaged/staged changes onto a ref stack (`refs/stash`). It does NOT remove files written by other agents. Agent B's untracked file `recall_pipeline.ts` is not in A's stash scope; it remains in the working-tree directory and is visible to A's `tsc --noEmit`. Stashing serializes one agent's uncommitted state; it provides zero isolation from siblings.

---

## §2 The Isolation Invariant

Let `WT(X)` be the set of files visible in agent X's working tree at any point in time.
Let `staged(X)` be X's git index (staged changes for the next commit).
Let `committed(Y)` be the committed file tree of branch Y at its HEAD.

**Invariant I1 (worktree isolation)**: For any agent X working on branch Y:

```
WT(X) = committed(Y) ∪ staged(X) ∪ unstaged(X)

where unstaged(X) ∩ unstaged(Z) = ∅  for all Z ≠ X
```

Equivalently: no file written by agent Z appears in WT(X) unless Z committed that file and X fetched the commit. All pre-commit and pre-push gates run inside `WT(X)` — they must be blind to WT(Z).

This invariant is **not satisfiable** when multiple agents share a single working-tree directory. The only structural satisfier is giving each agent its own directory.

---

## §3 Why `git worktree add` Is the Correct Tool

`git worktree` (git ≥ 2.5) creates an additional working-tree directory linked to the same repository object store. Each linked worktree has:

- Its own **working-tree directory** (a separate filesystem path).
- Its own **HEAD file** (independent branch pointer).
- Its own **index file** (independent staging area).

Consequence: `WT(A)` and `WT(B)` are disjoint filesystem trees. A file written by agent B into `worktrees/port-eng3/` is **never** visible to agent A's `tsc` or `eslint` running in `worktrees/port-eng1/`. The invariant I1 is structurally enforced.

`git stash`, `git checkout`, and manual file shuffling in a single working tree cannot enforce I1. `git worktree add` can and does.

---

## §4 Required Agent Protocol

Every agent MUST execute these steps in order. Deviation invalidates I1.

```bash
# Step 1 — from the main worktree (or ANY directory with repo access)
git fetch origin --quiet

# Step 2 — create isolated worktree + branch
bash scripts/spawn-worktree.sh <branch-slug>
# e.g.: bash scripts/spawn-worktree.sh exact-cortex-eng1-pg-stores
# → creates worktrees/port-<branch-slug>/ + branch port/<branch-slug>

# Step 3 — enter the isolated worktree; NEVER leave it during the mission
cd worktrees/port-<branch-slug>/

# Step 4 — install dependencies in this worktree's own node_modules
pnpm install --frozen-lockfile
# pnpm shares the content-addressable store; symlinks are fast.
# Each worktree gets its own node_modules tree so package resolution
# is not polluted by sibling worktrees.

# Step 5 — all edit / test / commit / push happens HERE
# Never cd back to the parent worktree during this mission.
# If you need to check something in another worktree, open a separate shell.

# Step 6 — after PR merges, clean up from the PARENT worktree
git worktree remove worktrees/port-<branch-slug>
git branch -d port/<branch-slug>
```

**Absolute prohibition**: an agent MUST NOT run `pnpm typecheck`, `pnpm test`, or `pnpm build` from the parent worktree root while another agent has uncommitted WIP in that same root. The parent worktree is used only for spawning and cleanup — never for WIP.

---

## §5 Required Hook Changes — Cross-Contamination Detection

Both hooks must refuse to run when the working tree contains files outside the agent's causal scope. Add the following contamination check as the FIRST gate in both `.husky/pre-commit` and `.husky/pre-push`.

```bash
# ── Contamination guard — must be the first gate ──────────────────────────────
# Enforces invariant I1: WT(X) = committed(Y) ∪ staged(X) ∪ unstaged(X).
# Any MODIFIED or UNTRACKED file that is NOT staged is potential cross-
# contamination from a sibling agent's WIP in a shared working tree.
#
# This check is intentionally strict: if you have legitimate unstaged changes
# (work-in-progress you intend to keep), stash them explicitly before committing.
# source: docs/audits/WORKTREE_ISOLATION_PROTOCOL_2026-05-04.md §5

echo "pre-commit: [0/N] contamination guard..." >&2

UNSTAGED_MODIFIED=$(git diff --name-only)
UNTRACKED=$(git ls-files --others --exclude-standard)

if [[ -n "$UNSTAGED_MODIFIED" || -n "$UNTRACKED" ]]; then
  echo "" >&2
  echo "ABORT: contamination guard triggered." >&2
  echo "The working tree contains files outside the staged set for this commit." >&2
  echo "These may be WIP from another agent contaminating this worktree." >&2
  echo "" >&2
  if [[ -n "$UNSTAGED_MODIFIED" ]]; then
    echo "Unstaged modified files:" >&2
    echo "$UNSTAGED_MODIFIED" | sed 's/^/  /' >&2
  fi
  if [[ -n "$UNTRACKED" ]]; then
    echo "Untracked files:" >&2
    echo "$UNTRACKED" | sed 's/^/  /' >&2
  fi
  echo "" >&2
  echo "Resolution options:" >&2
  echo "  1. git stash push --include-untracked   (if files are YOUR WIP to return to)" >&2
  echo "  2. git clean -fd                         (if files are debris to discard)" >&2
  echo "  3. Move the files to their correct worktree." >&2
  echo "" >&2
  echo "If this is a dedicated git worktree (worktrees/<branch>/), this error" >&2
  echo "means another agent wrote into your worktree directory. Identify and" >&2
  echo "evict the contamination before proceeding." >&2
  exit 1
fi

echo "pre-commit: [0/N] contamination guard passed — working tree is clean." >&2
```

Place this block immediately after `set -euo pipefail` and before Gate 1 in both hooks. Update the gate numbering (current `[1/3]` → `[1/4]` in pre-commit; `[1/6]` → `[1/7]` in pre-push).

---

## §6 Required `spawn-worktree.sh` Changes

The current script does not check parent worktree cleanliness, does not install dependencies, and does not embed a path-awareness reminder. Apply the following additions.

```bash
# After: cd "$REPO_ROOT"
# Add this block before the worktree-exists check:

# ── Parent cleanliness guard ──────────────────────────────────────────────────
# Refuse to spawn if the parent working tree is dirty.
# Rationale: a dirty parent signals a previous agent's WIP leaked here.
# Clean first; then spawn. This enforces invariant I1 from the start.
PARENT_DIRTY=$(git diff --name-only; git ls-files --others --exclude-standard)
if [[ -n "$PARENT_DIRTY" ]]; then
  echo "error: parent worktree is dirty — clean it before spawning." >&2
  echo "Dirty files:" >&2
  echo "$PARENT_DIRTY" | sed 's/^/  /' >&2
  echo "" >&2
  echo "Run: git stash push --include-untracked   # or git clean -fd" >&2
  exit 1
fi
```

```bash
# After: echo "wrote $MISSION_PATH"
# Add auto-install:

# ── Auto-install dependencies in the new worktree ────────────────────────────
echo "installing dependencies in $WORKTREE_DIR..."
(cd "$WORKTREE_DIR" && pnpm install --frozen-lockfile --reporter=silent)
echo "pnpm install: done"
```

Update the MISSION.md template stamp in the script to include the worktree's absolute path prominently:

```bash
# After: sed -i.bak "s/<module-name>/${MODULE}/g" ...

WORKTREE_ABS="$(cd "$WORKTREE_DIR" && pwd)"
# Stamp the absolute path into MISSION.md for the agent's orientation check.
sed -i.bak "s|<worktree-path>|${WORKTREE_ABS}|g" "$MISSION_PATH" && rm "${MISSION_PATH}.bak"
```

Add the corresponding placeholder to `docs/WORKTREE_MISSION_TEMPLATE.md`:

```markdown
> **ISOLATION CHECK**: This worktree is at `<worktree-path>`.
> Before any edit: confirm `pwd` matches this path.
> If it does not, STOP — you are in the wrong working tree.
```

---

## §7 Cleanup Procedure for Current Contamination

The parent worktree (`/Users/cdeust/Developments/agentic-ai`) is currently on branch `port/exact-cortex-eng1-pg-stores` with leaked WIP from at least Eng-3 (untracked recall files) and Eng-10 (multiple stashes). It also has worktrees in `/private/tmp/` outside the repo tree (invisible to `git worktree remove` without the exact path).

### 7.1 Inventory stashes with context

```bash
cd /Users/cdeust/Developments/agentic-ai
git stash list --format="%gd | %s | branch: %gs"
```

Current stash inventory (from this session's observation):

| Ref | Branch context | Description | Disposition |
|---|---|---|---|
| stash@{0} | port/exact-cortex-eng1-pg-stores | WIP pg_schema port | KEEP if Eng-1 PR not merged |
| stash@{1} | port/exact-cortex-eng7-handlers-registries | neuro models | KEEP if Eng-7 PR not merged |
| stash@{2} | port/exact-cortex-eng4-wiki | eng4-cherry-prep | HUMAN DECISION (see §8) |
| stash@{3} | port/exact-cortex-eng4-wiki | eng4-wiki work | HUMAN DECISION |
| stash@{4} | port/exact-cortex-eng4-wiki | eng4-other-branch-files | HUMAN DECISION |
| stash@{5} | port/exact-cortex-eng2-sqlite-stores | sqlite port WIP | KEEP if Eng-2 PR not merged |
| stash@{6} | port/exact-cortex-eng8-context-assembly | eng4-all (mislabeled) | HUMAN DECISION |
| stash@{7} | port/exact-cortex-eng2-sqlite-stores | duplicate sqlite WIP | likely DROP if stash@{5} covers it |
| stash@{8}–{13} | port/exact-zetetic-eng10 | 6 eng10 temp stashes | HUMAN DECISION — likely recoverable from Eng-10's worktree if it still exists |
| stash@{14} | main | WIP on main | HUMAN DECISION |
| stash@{15} | main | WIP on main | HUMAN DECISION |

### 7.2 Restore parent worktree to match `origin/main` exactly

```bash
cd /Users/cdeust/Developments/agentic-ai

# 1. Fetch latest
git fetch origin --quiet

# 2. Switch to main
git checkout main

# 3. Hard-reset to origin/main (destructive — ensure stashes above are triaged first)
git reset --hard origin/main

# 4. Remove untracked files and directories (IRREVERSIBLE — run dry-run first)
git clean -ndx    # dry-run: shows what would be deleted
# If the list looks correct:
git clean -fdx    # actual clean
```

**Do not run step 3-4 until §8 decisions are made.** These are destructive and cannot be undone without the stashes.

### 7.3 Handle out-of-repo worktrees in `/private/tmp/`

```bash
# These worktrees are registered in the git object store but their directories
# are in /private/tmp/ which may be cleaned by macOS at any time.
git worktree list | grep '/private/tmp/'
# Shows: /private/tmp/eng2-work, /private/tmp/eng3-worktree, /private/tmp/eng9-worktree

# If the directories still exist and contain unmerged work, recover before removing:
ls /private/tmp/eng2-work /private/tmp/eng3-worktree /private/tmp/eng9-worktree 2>/dev/null

# Remove the registration (safe even if directory is gone):
git worktree remove --force /private/tmp/eng2-work    2>/dev/null || true
git worktree remove --force /private/tmp/eng3-worktree 2>/dev/null || true
git worktree remove --force /private/tmp/eng9-worktree 2>/dev/null || true

# Prune stale worktree refs:
git worktree prune
```

### 7.4 List and remove dead `worktrees/*` directories

```bash
# For each worktree whose branch has already been merged to main:
git branch --merged main | grep 'port/'
# Any branch listed here has its work on main — the worktree is safe to remove.

# Remove each merged one:
# git worktree remove worktrees/port-<name>
# git branch -d port/<name>

# Non-interactive batch (review output before running):
git branch --merged main | grep 'port/' | while read -r br; do
  dir="worktrees/${br//\//-}"   # port/foo → worktrees/port-foo
  if [[ -d "$dir" ]]; then
    echo "removing $dir (branch $br merged)"
    git worktree remove "$dir"
    git branch -d "$br"
  fi
done
```

---

## §8 Open Questions for Human Decision

The following require a human decision before cleanup can proceed:

1. **Stashes @{2}, @{3}, @{4}, @{6} (eng4-wiki + eng8-labeled as eng4)**: Are these recoverable from the Eng-4 or Eng-8 worktrees (`worktrees/port-cortex-wiki`, `worktrees/port-cortex-workflow-graph`)? If those worktrees have the same content committed or staged, these stashes are redundant and can be dropped with `git stash drop stash@{N}`.

2. **Stashes @{8}–@{13} (six eng10 temp stashes)**: Eng-10's declared work was two trivial doc changes. Six stashes suggests significant cross-contamination was accumulated and partially managed. Are any of these files that should go into Eng-10's PR, or are they all other agents' WIP that ended up in the parent tree and should be discarded?

3. **Stashes @{14} and @{15} (WIP on main)**: Work staged directly on `main` is a protocol violation. Identify what these contain (`git stash show -p stash@{14}`) and determine whether they belong to any open branch.

4. **The parent worktree's current HEAD** is on `port/exact-cortex-eng1-pg-stores` (Eng-1). This means the parent worktree is acting as Eng-1's working tree, not as the neutral main. Eng-1 should be moved to its own `worktrees/port-exact-cortex-eng1-pg-stores/` directory and the parent should be returned to `main`.

5. **`/private/tmp/eng*` worktrees**: `/private/tmp` is macOS's volatile temp directory, cleaned on reboot. If any of these worktrees hold unmerged, unstashed work and the machine has rebooted since they were created, the work is gone. Verify now.

---

## Invariant Summary

| Invariant | Statement | Mechanism |
|---|---|---|
| I1 (isolation) | WT(X) = committed(Y) ∪ staged(X) ∪ unstaged(X); disjoint from all other agents | `git worktree add` — separate filesystem directories |
| I2 (clean spawn) | Parent worktree is clean before any new worktree is spawned | `spawn-worktree.sh` dirty-check gate |
| I3 (hook scope) | Pre-commit/pre-push see only committed(Y) ∪ staged(X) | Contamination guard as hook gate 0 |
| I4 (causality) | Agent X's gate failures are caused only by X's own changes | I1 + I3 together |

These four invariants together eliminate the class of cross-contamination bugs observed in this session. They hold initially (fresh worktree = clean) and are preserved by every protocol step above (induction: each step either creates a new clean worktree or removes a spent one, never mixing states).
