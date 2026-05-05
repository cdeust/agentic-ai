# Worktree Isolation Protocol

**Status:** Mandatory — enforced by pre-commit and pre-push hooks as of 2026-05-04.
**Applies to:** every parallel engineer dispatch in the agentic-ai monorepo.

---

## 1. The Problem

The agentic-ai monorepo uses `git worktree` to run multiple engineer agents in
parallel. Each agent works on its own branch inside its own worktree directory
under `worktrees/`. This isolation is what allows 10+ engineers to be active
simultaneously without interfering.

**Cross-worktree contamination** breaks this isolation. It happens when:

- An engineer makes file-system changes (new files, edits) in the parent worktree
  (`/Users/cdeust/Developments/agentic-ai`) instead of its assigned child worktree.
- An engineer runs `cd` back to the parent worktree mid-task.
- A script or tool resolves `git rev-parse --show-toplevel` and inadvertently
  operates on the parent tree.

The consequence: untracked or modified files from one engineer's work appear as
noise in a different engineer's staged commit, causing the pre-commit hook to
fail with a contamination error — even though that engineer's own code is clean.
This was the primary cause of false-fail pre-commit runs in PRs #18-#42.

---

## 2. The Required Workflow

### Spawning a worktree (orchestrator)

Always use `scripts/dispatch-engineer.sh` before dispatching an engineer:

```bash
bash scripts/dispatch-engineer.sh <branch>
# Prints: ENGINEER_WORKTREE_PATH=/Users/cdeust/Developments/agentic-ai/worktrees/<slug>
```

This script:
1. Aborts if the parent worktree is dirty (Guard 1 — no contamination escapes).
2. Aborts if the branch already exists locally or on origin (Guard 2 — no double-dispatch).
3. Creates the worktree via `git worktree add -b <branch>`.
4. Runs `pnpm install` inside the new worktree.
5. Prints the absolute worktree path for use in the engineer's prompt.

### Working in a worktree (engineer)

Include this in every engineer prompt:

> Work in `<ENGINEER_WORKTREE_PATH>`; cd there once and never cd out.
> All commits, all file edits, all tool calls must happen inside that directory.

Concretely:
1. `cd /Users/cdeust/Developments/agentic-ai/worktrees/<slug>` — once, at the start.
2. Do all work here. Never call `cd` with the parent path again.
3. `git add <files>` — only the files you intentionally changed.
4. `git commit` — the pre-commit hook runs the contamination check automatically.
5. `git push -u origin <branch>` — the pre-push hook runs the same check before push.

### What "clean" means

A worktree is clean when:
- `git diff --name-only` returns empty (no unstaged modifications).
- `git ls-files --others --exclude-standard` returns empty (no untracked files).

Exception: `packages/memory/__tests__/recall/expected/*.tsoutput.json` files are
regenerated on every test run and are excluded from the contamination check. They
are never committed; they are `.gitignore`-exempt noise.

---

## 3. Hook-Detection Mechanism

Both `.husky/pre-commit` and `.husky/pre-push` run Gate 0 — the contamination
check — before any other gate:

```bash
unstaged_modified="$(git diff --name-only)"
untracked="$(git ls-files --others --exclude-standard)"

# filter out recall fixture timestamps (known benign noise)
filtered_modified=$(echo "$unstaged_modified" | grep -v '^packages/memory/__tests__/recall/expected/.*\.tsoutput\.json$' || true)
filtered_untracked=$(echo "$untracked" | grep -v '^packages/memory/__tests__/recall/expected/.*\.tsoutput\.json$' || true)

if [[ -n "$filtered_modified$filtered_untracked" ]]; then
  echo "::error:: Working tree contamination detected ..."
  exit 1
fi
```

The check is position-zero: it runs before lint, typecheck, build, or tests. A
contaminated tree fails immediately with a clear message naming the offending files.

---

## 4. Recovering from a Contamination Hook

If you hit the contamination hook, one of three things is true:

**Case A: The files belong to your own work but weren't staged.**

```bash
git add <your-files>
git commit
```

**Case B: The files belong to another branch / agent.**

```bash
# identify where they belong
git status

# move them to the right branch by stashing, switching, and unstashing
git stash push <file1> <file2>
git checkout <right-branch>
git stash pop
git add <files> && git commit
```

**Case C: The files are leftover noise (auto-generated, scratch work).**

```bash
# discard them
git checkout -- <modified-file>
rm <untracked-file>
```

After any of the above, re-run your commit. The hook will pass once the working
tree outside the staged set is clean.

---

## 5. Removing Dead Worktrees

A worktree is dead when its branch has been merged and deleted from origin.

```bash
# list all worktrees
git worktree list

# prune worktrees whose branch is gone
git worktree prune

# remove a specific dead worktree manually
git worktree remove worktrees/<slug>
# or if it has leftover files:
git worktree remove --force worktrees/<slug>
```

Run `git worktree prune` periodically (e.g., after each batch of PR merges) to
keep the worktrees/ directory from accumulating stale entries.

---

## 6. Reference

- `scripts/spawn-worktree.sh` — strict worktree creation (Guards 1 + 2).
- `scripts/dispatch-engineer.sh` — orchestrator wrapper; use this, not spawn directly.
- `.husky/pre-commit` — Gate 0 contamination check + Gates 1-3 (citation, lint, typecheck).
- `.husky/pre-push` — Gate 0 contamination check + Gates 1-6 (install, build, layer-check, citation, migration, test).
