# Cutover Runbook — Phase 6

Operator-facing. Intended audience: the person executing the final cutover
commits across the four source repositories. Read this document completely
before touching any repository.

---

## 1. Pre-flight checks (ALL must pass before proceeding)

Run these checks in order. Stop at any failure and resolve before continuing.

### 1.1 CI green on agentic-ai main

```bash
gh run list --repo cdeust/agentic-ai --branch main --limit 5
# Every listed run must show "completed / success".
# Zero failures. Zero cancelled runs hiding a failure.
```

Specifically verify these gates are HARD (not `|| true`):

| Gate | File | Expected status |
|---|---|---|
| `pnpm install --frozen-lockfile` | `.github/workflows/ci.yml` | HARD |
| `pnpm build` | `.github/workflows/ci.yml` | HARD |
| `pnpm test` | `.github/workflows/ci.yml` | HARD |
| Plugin manifest lint | `.github/workflows/ci.yml` | HARD |

### 1.2 Parity dual-run green for 48 consecutive hours

```bash
gh run list --repo cdeust/agentic-ai --workflow parity-dual-run.yml --limit 48
# All 48 most recent runs must show "completed / success".
# Any single failure restarts the 48-hour clock.
```

The parity dual-run compares live output from:
- Cortex Python MCP vs `@agentic/mcp-server-memory`
- automatised-pipeline Rust binary vs `@agentic/mcp-server-codebase`
- prd-spec-generator Node vs `@agentic/mcp-server-prd`

A divergence in any runner falsifies the "ready to cut over" claim.

### 1.3 No open CRIT findings

```bash
gh issue list --repo cdeust/agentic-ai --label "severity:crit" --state open
# Must return empty.
```

CRIT findings with open status block cutover unconditionally. Resolve or
explicitly defer with an ADR entry before proceeding.

### 1.4 Four MIGRATED.md files staged

```bash
ls cutover-staging/*/MIGRATED.md
# Expected output:
# cutover-staging/Cortex/MIGRATED.md
# cutover-staging/automatised-pipeline/MIGRATED.md
# cutover-staging/zetetic-team-subagents/MIGRATED.md
# cutover-staging/prd-spec-generator/MIGRATED.md
```

---

## 2. Sequence of commits across the four source repos

Execute in the order listed. Do not parallelise steps 2.1–2.4 — complete each
step fully before starting the next.

### 2.1 cdeust/Cortex

```bash
# Clone a fresh copy (read the MIGRATED.md into the source repo root)
git clone https://github.com/cdeust/Cortex.git /tmp/cortex-cutover
cd /tmp/cortex-cutover

# Copy the staged MIGRATED.md
cp /path/to/agentic-ai/cutover-staging/Cortex/MIGRATED.md ./MIGRATED.md

# Commit
git add MIGRATED.md
git commit -m "$(cat <<'EOF'
chore(cutover): add MIGRATED.md — runtime moved to agentic-ai

Cortex's MCP-over-stdio runtime is now @agentic/mcp-server-memory.
HTTP dashboard users: see MIGRATED.md §Path B — stay on this repo
until @agentic/memory v0.4.x (ADR-0011).
EOF
)"
git push origin main
```

### 2.2 cdeust/automatised-pipeline

```bash
git clone https://github.com/cdeust/automatised-pipeline.git /tmp/automate-cutover
cd /tmp/automate-cutover
cp /path/to/agentic-ai/cutover-staging/automatised-pipeline/MIGRATED.md ./MIGRATED.md
git add MIGRATED.md
git commit -m "$(cat <<'EOF'
chore(cutover): add MIGRATED.md — runtime moved to agentic-ai

Rust binary is now bundled in @agentic/mcp-server-codebase.
Breaking: partial (run_id, finding_id, output_dir) triples now error
at the TS adapter layer (ADR-0004).
EOF
)"
git push origin main
```

### 2.3 cdeust/zetetic-team-subagents

```bash
git clone https://github.com/cdeust/zetetic-team-subagents.git /tmp/zetetic-cutover
cd /tmp/zetetic-cutover
cp /path/to/agentic-ai/cutover-staging/zetetic-team-subagents/MIGRATED.md ./MIGRATED.md
git add MIGRATED.md
git commit -m "$(cat <<'EOF'
chore(cutover): add MIGRATED.md — agents moved to agentic-ai

97 genius patterns + 19 team agents migrated as .md prompt files.
No behaviour change. New install: @agentic/mcp-server-reasoning.
EOF
)"
git push origin main
```

### 2.4 cdeust/prd-spec-generator

```bash
git clone https://github.com/cdeust/prd-spec-generator.git /tmp/prd-cutover
cd /tmp/prd-cutover
cp /path/to/agentic-ai/cutover-staging/prd-spec-generator/MIGRATED.md ./MIGRATED.md
git add MIGRATED.md
git commit -m "$(cat <<'EOF'
chore(cutover): add MIGRATED.md — runtime moved to agentic-ai

17 MCP tools preserved. Bundle preserved byte-for-byte (ADR-0006).
New install: @agentic/mcp-server-prd.
EOF
)"
git push origin main
```

### 2.5 Publish npm packages

```bash
cd /path/to/agentic-ai

# Build all four MCP server packages
pnpm -F @agentic/mcp-server-memory build
pnpm -F @agentic/mcp-server-codebase build
pnpm -F @agentic/mcp-server-reasoning build
pnpm -F @agentic/mcp-server-prd build

# Publish (adjust version numbers as appropriate)
pnpm -F @agentic/mcp-server-memory publish --access public
pnpm -F @agentic/mcp-server-codebase publish --access public
pnpm -F @agentic/mcp-server-reasoning publish --access public
pnpm -F @agentic/mcp-server-prd publish --access public
```

### 2.6 Flip agentic-ai from private to public

```bash
gh repo edit cdeust/agentic-ai --visibility public
```

Verify: `gh repo view cdeust/agentic-ai --json visibility` returns `"PUBLIC"`.

### 2.7 Publish announcement

Deploy `cutover-staging/cdeust.github.io/announcement.md` to the blog/site.
See the placeholder comment in that file for path instructions.

---

## 3. GitHub Actions: archive each source repo

Archive each source repo after the MIGRATED.md commit has been pushed and
verified in step 2.

```bash
gh repo archive cdeust/Cortex --yes
gh repo archive cdeust/automatised-pipeline --yes
gh repo archive cdeust/zetetic-team-subagents --yes
gh repo archive cdeust/prd-spec-generator --yes
```

Verify each:
```bash
for repo in Cortex automatised-pipeline zetetic-team-subagents prd-spec-generator; do
  echo -n "$repo: "
  gh repo view "cdeust/$repo" --json isArchived --jq '.isArchived'
done
# Expected: four "true" lines
```

---

## 4. DNS / redirect changes

No DNS changes are required. The four repos are GitHub-hosted; archiving them
preserves their URLs. All existing links (`https://github.com/cdeust/Cortex`,
etc.) continue to resolve — GitHub does not remove archived repos.

If the Claude Code marketplace has a listing for any of the four repos, update
the listing to point to the agentic-ai successor. This is a manual step in the
Claude Code marketplace admin panel — no automation exists for this.

---

## 5. Rollback procedure

A "critical regression" is defined as: any MCP tool call that previously
returned a correct result under the source-repo binary now returns an incorrect
result or an error under the unified install, AND the parity dual-run did not
catch it.

### 5.1 If regression is detected within 72 hours of cutover

1. **Do not un-archive the source repos.** Archiving is reversible but creates
   confusion. Leave the repos archived.
2. **Communicate immediately.** Post to `cdeust/agentic-ai` Discussions with
   the exact tool name, input, expected output, and actual output.
3. **Open a CRIT issue** on agentic-ai: `gh issue create --repo cdeust/agentic-ai --label "severity:crit"`.
4. **The source repos' Python/Rust binaries are still functional.** Users who
   need to revert can re-register the source-repo binary in their `.mcp.json`
   while the fix is in progress. Instructions:
   ```bash
   # Cortex: re-enable old Python install
   claude plugin install cortex   # marketplace entry still works until archive

   # automatised-pipeline: rebuild from the archived source
   git clone https://github.com/cdeust/automatised-pipeline.git
   cd automatised-pipeline && cargo build --release
   ```
5. **Fix in agentic-ai.** Land the fix on `main`. CI must go green. Parity
   dual-run must complete 4 additional hours of clean runs before re-deploying.
6. **Publish a patch release** of the affected `@agentic/mcp-server-*` package.

### 5.2 If regression is detected after 72 hours but within 7 days (first week)

Follow steps 2–6 above. Additionally, update the `MIGRATED.md` in the archived
source repo to note the regression and the patch release that resolves it.

### 5.3 After 7 days

The source repo binaries are still accessible (archived, not deleted). Users
who encounter regressions must file issues on agentic-ai. The rollback window
for the unified install is closed; only forward patches are issued.

---

## 6. Verification checklist (post-cutover, same day)

Run within 4 hours of completing step 2.7.

- [ ] `npm info @agentic/mcp-server-memory version` returns expected version
- [ ] `npm info @agentic/mcp-server-codebase version` returns expected version
- [ ] `npm info @agentic/mcp-server-reasoning version` returns expected version
- [ ] `npm info @agentic/mcp-server-prd version` returns expected version
- [ ] All four source repos show `isArchived: true`
- [ ] `gh repo view cdeust/agentic-ai --json visibility` returns `PUBLIC`
- [ ] MIGRATED.md visible at `https://github.com/cdeust/Cortex/blob/main/MIGRATED.md`
- [ ] Announcement published at cdeust.github.io
- [ ] Parity dual-run CI green on agentic-ai main post-publish
- [ ] Zero CRIT issues open on agentic-ai

---

*This runbook is a Phase 6 deliverable. It does not replace human judgment.*
*If anything in this document is ambiguous, stop and ask before acting.*
