# Freeze Rules — `@agentic/core`

> Once Phase 0 lands (`port/core-types` merges to `main`) and Phase 4 parallel
> worktrees branch from `main`, the `packages/core/` directory is FROZEN.
>
> This document defines what "frozen" means, when it can be unfrozen, and the
> exact process for doing so safely.

---

## Why freeze?

Phase 4 runs 8+ worktrees in parallel, each building against the type surface
defined in `packages/core/src/`. A change to a shared type mid-flight causes:
1. Silent type drift: the changed worktree builds; others do not; conflicts
   appear only at integration.
2. Lost parallelism: every worktree must rebase and re-verify before continuing.
3. Contract inversion: a worktree that has already implemented a Port adapter
   may silently violate the new postcondition.

The freeze is the equivalent of Pāṇini freezing the Shiva Sutras before the
Ashtadhyayi rules are written. The metalanguage must be stable before the rules
that reference it can be complete.

---

## Rule 1 — Definition of "frozen"

After `port/core-types` merges to `main`:

- No file under `packages/core/src/` may be modified directly in any parallel
  worktree.
- No parallel worktree may add, remove, or rename an export from
  `packages/core/src/index.ts`.
- No parallel worktree may change the shape of any Zod schema in
  `packages/core/src/domain/**/*.ts`.
- No parallel worktree may change the signature of any method in
  `packages/core/src/ports/**/*.ts`.

Violation of Rule 1 is a **blocker** — the PR cannot merge until the violation
is resolved.

---

## Rule 2 — Permitted changes without ADR

The following changes do NOT break the freeze and require only a normal PR review:

- Adding a new **constant** (e.g., a lookup table `SECTION_DISPLAY_NAMES`) that
  does not change any schema or port signature.
- Adding a new **utility function** (pure, no I/O) in `packages/core/src/utils/`.
- Fixing a **documentation comment** or `// source:` annotation.
- Bumping the `package.json` version field.

These changes must still pass `tsc --strict` across all worktrees.

---

## Rule 3 — Type-amendment ADR process

Any change that modifies an existing type or port signature, or adds a new
exported type, follows this process:

### Step 1 — File the ADR

Create `docs/adrs/ADR-NNNN-<slug>.md` in the monorepo root (not inside the
worktree). Template at `docs/adrs/ADR-TEMPLATE.md`. The ADR must answer:

1. **What** is being changed (exact file + line reference).
2. **Why** is the change needed (which parallel worktree is blocked and why
   the existing type is insufficient).
3. **Liskov impact**: does the change weaken any Port postcondition or strengthen
   any precondition? If yes, this is a **breaking change** (see Step 3).
4. **Panini impact**: does the change introduce a redundant type or a type that
   already exists under a different name?
5. **Blast radius**: list every parallel worktree that imports the changed type.
   These worktrees MUST rebase off the new `main` tip before continuing.

### Step 2 — Sign-off requirements

| Change type | Required sign-offs |
|---|---|
| New type (additive, no existing type changed) | `liskov` + `panini` + `code-reviewer` |
| Rename (no semantic change) | `liskov` + `code-reviewer` |
| Field addition (non-breaking: new optional field) | `liskov` + `code-reviewer` |
| Field type widening (e.g., `string` → `string \| null`) | `liskov` + `panini` + `feynman` |
| Field removal or narrowing (breaking) | `liskov` + `panini` + `feynman` + **human reviewer** |
| Port method addition | `liskov` + `panini` + `code-reviewer` |
| Port method removal or signature change | `liskov` + `panini` + `feynman` + **human reviewer** |

**`liskov`** verifies substitutability: the new type or signature must not
violate the Liskov Substitution Principle relative to all existing adapters.

**`panini`** verifies economy: the new type must not duplicate an existing type
and must be constructable from existing primitives where possible.

**`feynman`** is required for breaking changes: rederives at least one invariant
from the source to confirm the amendment preserves semantic correctness.

### Step 3 — Breaking vs non-breaking

A change is **breaking** if any of these are true:
- A required field is removed from a Zod schema.
- A required field's type is narrowed (e.g., `z.string()` → `z.string().uuid()`).
- A Port method is removed.
- A Port method's parameter type is narrowed (stronger precondition).
- A Port method's return type is widened (weaker postcondition).
- An enum loses a member.

Breaking changes CANNOT land while parallel worktrees are open. The parallel
worktrees must be paused, rebased off the new `main`, and re-verified before
the breaking ADR can merge.

Non-breaking changes (new optional fields, new enum members, new types) may
land while parallel worktrees are open, subject to the rebase requirement
in Step 4.

### Step 4 — Rebase protocol

After an ADR merges:

1. The ADR author opens an issue tagging every affected parallel worktree.
2. Each affected worktree owner rebases their branch off the new `main` within
   24 hours.
3. Each affected worktree runs `pnpm typecheck` and posts the result in the issue.
4. The issue is closed only when all affected worktrees pass typecheck.

Parallel worktrees that have not rebased within 24 hours are considered
**stale** and may be force-rebased by the monorepo owner.

---

## Rule 4 — CODEOWNERS enforcement

`packages/core/` has a CODEOWNERS entry:

```
packages/core/   @cdeust
```

Every PR that touches `packages/core/` requires explicit approval from
`@cdeust`. GitHub branch protection enforces this. No workaround.

---

## Rule 5 — Automated guard

The CI pipeline runs a `type-surface-diff` check on every PR:

```sh
# scripts/check-type-surface-diff.sh
# Fails if any file in packages/core/src/ has changed without an ADR
# number in the PR description matching docs/adrs/ADR-NNNN-*.md.
```

PRs that modify `packages/core/src/` without a matching ADR in the description
are blocked by CI. This is a hard gate — no bypass exists.

---

## Rule 6 — Unfreeze (end of Phase 4)

The freeze lifts when ALL parallel Phase 4 worktrees have merged to `main` and:
1. The parity-oracle suite passes 100% across all packages.
2. The integration test suite in `packages/mcp-servers/` passes.
3. A human reviewer (owner) explicitly marks the milestone `phase-4-complete`.

After unfreeze, `packages/core/` follows the normal monorepo PR process (no
ADR required, but still subject to `tsc --strict` and `liskov` review on
Port changes).

---

## Rationale for these rules (Pāṇinian)

The freeze is a conflict-resolution meta-rule applied at the repository level:
when two parallel worktrees could both modify the same shared type and produce
conflicting results, the meta-rule (only ADR-approved changes land during
the parallel phase) resolves the conflict before it occurs. This is the
repository-level analogue of Pāṇini's "right-hand element wins" resolution rule:
the Core type space is the base form; parallel worktrees are the derived forms;
derived forms do not modify the base.

A type system without a freeze is a type system without conflict resolution —
it is ambiguous at every integration point. The freeze makes the ambiguity
impossible to reach.
