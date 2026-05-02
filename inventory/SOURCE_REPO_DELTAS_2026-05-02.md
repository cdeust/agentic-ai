# Source-Repo Drift Audit — 2026-05-02

**Purpose**: snapshot of where each of the 4 upstream source repos sits today vs the last time the monorepo synced against them. Read this before opening a Phase-7-resync worktree so the scope is correct.

**Author**: agentic-ai port maintenance (2026-05-02)

| Source repo | Last-sync HEAD | Current HEAD | Commits ahead | Action recommended |
|---|---|---|---|---|
| **Cortex (Python)** | `f2b9f99` (2026-04-28) | `bc0ae4f` (2026-05-02) | **28** | `port/cortex-resync-2026-05-02` worktree — see `inventory/CORTEX_DELTA.md` Group 7 for the breakdown |
| **automatised-pipeline (Rust)** | imported verbatim 2026-04-28 (Phase 3 PR #18) | `2cc3780` marketplace bump v0.0.4 | **0** since import | NONE — Rust workspace import was a one-shot copy at v0.0.4; the monorepo owns canonical history forward (per PHASE_3_PLAN.md §C) |
| **prd-spec-generator (TS)** | `5bb7dd9` (2026-04-28, merged via PR #14) | `5bb7dd9` (unchanged) | **0** | NONE — source repo is stable; the monorepo's `packages/prd-pipeline/` is the canonical home |
| **zetetic-team-subagents (Bash + MD)** | `36ac353` (Phase 2 zetetic merge, 2026-04-27) | `75c0b0d` LinkedIn-post fixes | **~5** | LOW priority — the new commits are LinkedIn marketing posts, not agent content. Skip unless the post text is needed in `packages/reasoning/assets/linkedin/` |

---

## Cortex — see CORTEX_DELTA.md §Group 7

28 commits between `f2b9f99..bc0ae4f`. Categorization:

- **Verification ablations (16 commits)**: 23 named `CORTEX_ABLATE_<MECH>` env-var guards wired into the recall hot-path. Mirrors needed in `packages/memory/src/recall/` for Group B parity.
- **Benchmark infrastructure (8 commits)**: pure Python test harness; **no TS port impact**.
- **Paper revisions (4 commits)**: documentation only; **no TS port impact**.
- **Bug fixes (2 commits)**: `df14e16` DDL comment-break, `34aa452` docstring boundary in `cls.run_cls_cycle` — verify TS counterparts don't carry the same bugs.

Recommended worktree: `port/cortex-resync-2026-05-02`. Tracked under PHASE_7_TRACKING.md Group H as a follow-up wave.

---

## automatised-pipeline (Rust) — no delta to chase

Per PHASE_3_PLAN.md §Appendix C decision (2026-04-28): "The Rust files in `packages/codebase-rust/` are a copy with a single import commit, NOT a git-subtree-add… agentic-ai will own the canonical history going forward. Trade-off: lose individual upstream commit attributions. Mitigation: link to the GitHub-archived source repo from `packages/codebase-rust/README.md`."

The upstream repo's HEAD `2cc3780` is "marketplace: bump version to 0.0.4" — a bookkeeping commit, not a code change. The Rust workspace already imported at v0.0.4 (verified via `grep version packages/codebase-rust/Cargo.toml` → `0.0.4`).

If upstream lands new Rust features post-cutover, a *manual* re-import (cherry-pick file changes, NOT history rewrite) is the path — same as the original import. Tracked in PHASE_PLAN Phase 3 §"after public flip".

---

## prd-spec-generator (TS) — frozen post-cutover

Source HEAD `5bb7dd9` matches what was merged via PR #14. The MIGRATED.md staged in `cutover-staging/prd-spec-generator/MIGRATED.md` redirects users to `packages/prd-pipeline/` once the public flip lands.

If upstream lands new commits between now and cutover:
- The monorepo's history is already grafted via filter-repo at `5bb7dd9`
- Any new upstream commits would need a follow-up filter-repo + merge — same pattern as `migration/SCRIPT.sh` but with a base shifted to current `feat/prd-spec-migration`-style branch
- Unlikely to be needed: the user explicitly said 2026-04-28 "PRD SPEC GENERATOR WAS STABILIZED NOW"

---

## zetetic-team-subagents — LinkedIn drift only

5 new commits between the Phase 2 zetetic merge HEAD and current upstream HEAD `75c0b0d`. All 5 are LinkedIn marketing post tweaks (em-dash removal, character-count trimming, fabricated-story replacement).

The 98 reasoning patterns + 19 team agents content (the load-bearing part of the migration) is unchanged in those commits. **No re-port needed**.

If the LinkedIn post changes need to ship in `packages/reasoning/assets/linkedin/` for marketplace consistency, a small chore commit can bring them across — but it's not blocking anything.

---

## Cutover implication

Phase 6 cutover (commit MIGRATED.md to source repos + flip public + archive) is **independent of these deltas**. The decision to flip public can proceed without first chasing upstream Cortex deltas — Group H Wave 2 can land *after* the public flip as a normal post-cutover hardening cycle.

**Order of operations the operator could follow**:
1. (Now) Merge open PRs #20, #21 once CI re-runs green.
2. (Now) Decide if the Cortex re-sync worktree opens before or after public flip — see `docs/PHASE_PLAN.md` Phase 6 / Phase 7 boundary.
3. (Operator) Push MIGRATED.md commits to the 4 source repos (the agent cannot push to repos it doesn't own).
4. (Operator) Flip `agentic-ai` private → public.
5. (Optional) Open `port/cortex-resync-2026-05-02` worktree for Group H Wave 2.

---

## Method note

This audit was generated by:
```bash
git -C <each-repo> log --since="<last-sync-date>" --oneline
git -C <each-repo> log --name-only --pretty=format: <baseline>..HEAD | sort -u
```

Re-run when source repos are bumped again.
