# Release Checklist — agentic-ai v0.1.0 Cutover Day

Operator-facing gate list. Work top-to-bottom. Do not proceed past a ☐ item.
Each item has a verification command and a rollback note.

---

## Pre-cutover Gates (must be satisfied before tag push)

### 1. CI green on `main`

- ☐ **CI green on `agentic-ai` main**: all jobs in `.github/workflows/ci.yml` pass
  on the HEAD commit of `main`. Includes: `pnpm install --frozen-lockfile`,
  `pnpm build`, `pnpm test`, plugin manifest lint.

  Verify: `gh run list --branch main --limit 3 --repo cdeust/agentic-ai`

  Rollback: push a fix commit; do NOT push the tag until CI is green.

- ☐ **Build gate hardened**: `.github/workflows/ci.yml` `Build` step must be a
  hard gate (no `|| echo "::warning::"`). See `docs/audits/FINAL_CROSS_AUDIT.md`
  finding F-CRIT-001.

  Verify: `grep "pnpm build" .github/workflows/ci.yml` — must NOT contain `|| echo`.

### 2. Parity dual-run — 48-hour zero-divergence window

- ☐ **Parity dual-run zero-divergence over 48 hours**: `scripts/parity-dual-run.sh`
  exits 0 on every run for 48 consecutive hours with all three live binaries available
  (`CORTEX_PYTHON_BIN`, `AI_ARCH_BIN`, `PRD_GEN_BIN` set in CI environment).

  Verify: `gh run list --workflow parity-dual-run.yml --limit 48`
  — all runs must show `completed / success`.

  Falsification condition: any single exit-code 1 over the 48-hour window resets
  the clock. Investigate and fix the divergence before restarting.

### 3. Cross-audit findings closed

- ☐ **All CRIT/HIGH findings in `docs/audits/FINAL_CROSS_AUDIT.md` closed**:
  each CRIT/HIGH finding must have a linked commit hash on `main` demonstrating
  resolution, or a signed-off deferral decision in an ADR.

  Verify: `grep -c "CRIT\|HIGH" docs/audits/FINAL_CROSS_AUDIT.md` → review each line.

### 4. License

- ☐ **LICENSE flipped to MIT**: root `LICENSE` file present; root `package.json`
  and all `packages/*/package.json` have `"license": "MIT"`.

  Verify:
  ```bash
  cat LICENSE | head -1            # must say "MIT License"
  grep '"license"' package.json   # must say "MIT"
  find packages -name package.json | xargs grep '"license"' | grep -v MIT
  # must return empty
  ```

### 5. CHANGELOG promoted

- ☐ **CHANGELOG `[Unreleased]` → `[v0.1.0]`**: rename the `## [Unreleased]` heading
  to `## [v0.1.0] — YYYY-MM-DD` and add a new empty `## [Unreleased]` above it.
  Update the diff link at the bottom.

  Edit: `CHANGELOG.md`

---

## Tag and Release

### 6. Tag pushed

- ☐ **Tag `v0.1.0` pushed to `origin/main`**:

  ```bash
  git tag v0.1.0 -m "v0.1.0 — initial public release"
  git push origin v0.1.0
  ```

  This triggers `.github/workflows/release.yml` which:
  1. Builds all packages.
  2. Runs `pnpm test`.
  3. Packs tarballs via `pnpm pack` for each workspace package.
  4. Creates a GitHub Release with auto-generated notes and attaches all tarballs.

  Verify: `gh release view v0.1.0 --repo cdeust/agentic-ai`

---

## Source Repo Cutover (four repos, in order)

Do NOT proceed to the next repo until the previous one is complete.

### 7. Commit MIGRATED.md to each source repo

Staged files are in `cutover-staging/`. Push each one to the corresponding
source repo's `main` branch.

- ☐ **cdeust/Cortex** — commit `cutover-staging/Cortex/MIGRATED.md` to
  `cdeust/Cortex` main.

  ```bash
  # from a checkout of cdeust/Cortex
  cp /path/to/agentic-ai/cutover-staging/Cortex/MIGRATED.md .
  git add MIGRATED.md
  git commit -m "chore: MIGRATED — repo unified into cdeust/agentic-ai"
  git push origin main
  ```

- ☐ **cdeust/automatised-pipeline** — commit
  `cutover-staging/automatised-pipeline/MIGRATED.md`.

- ☐ **cdeust/zetetic-team-subagents** — commit
  `cutover-staging/zetetic-team-subagents/MIGRATED.md`.

- ☐ **cdeust/prd-spec-generator** — commit
  `cutover-staging/prd-spec-generator/MIGRATED.md`.

### 8. Archive source repos

Archive (do NOT delete) each source repo on GitHub. Archiving sets the repo to
read-only; the history and issue tracker remain accessible.

- ☐ `cdeust/Cortex` archived:

  ```bash
  gh repo archive cdeust/Cortex --yes
  ```

- ☐ `cdeust/automatised-pipeline` archived:

  ```bash
  gh repo archive cdeust/automatised-pipeline --yes
  ```

- ☐ `cdeust/zetetic-team-subagents` archived:

  ```bash
  gh repo archive cdeust/zetetic-team-subagents --yes
  ```

- ☐ `cdeust/prd-spec-generator` archived:

  ```bash
  gh repo archive cdeust/prd-spec-generator --yes
  ```

---

## Public Flip

### 9. agentic-ai flipped from private to public

- ☐ Repo visibility changed to **public**:

  ```bash
  gh repo edit cdeust/agentic-ai --visibility public --accept-visibility-change-consequences
  ```

  Pre-conditions before running this command:
  - All items above are ☑.
  - No secrets, API keys, or personal tokens committed (run
    `git log --all -p | grep -iE "secret|api_key|token|password"` as a sanity check).
  - The announcement at `cutover-staging/cdeust.github.io/announcement.md` is ready
    to publish.

---

## Post-cutover Verification

- ☐ GitHub Release page shows tarballs attached.
- ☐ MIGRATED.md visible on each archived source repo.
- ☐ `cdeust/agentic-ai` shows as public.
- ☐ Install smoke test on a clean machine:
  `npx @agentic/mcp-server-memory --help` (or equivalent once npm publish is added).
- ☐ Announcement published to `cdeust.github.io`.
