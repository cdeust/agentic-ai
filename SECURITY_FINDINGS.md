# Security Audit — agentic-ai monorepo (2026-05-06)

**Scope.** OWASP Top 10 sweep over the production code paths of the agentic-ai
TypeScript monorepo, plus a `pnpm audit --prod` dependency review. Out of
scope: `cutover-staging/` (frozen Python source snapshots), test files,
lint/style.

**Method.**
1. Inventory: cataloged every `child_process` call site, every `JSON.parse`,
   every `query` / `prepare`, every `innerHTML`, every secret-shaped literal,
   and every plugin `.mcp.json`.
2. Falsifiable findings: each finding states an attack vector and an
   exploit payload that would make the previously-vulnerable code execute
   attacker-controlled code (or leak data).
3. Root-cause fixes: no band-aid sanitisers. argv-style invocation,
   parameterised SQL, DOM API rendering, frozen allowlists.
4. Falsification round-trip: each fix has a regression test that fails on
   the previously-vulnerable code (verified by reverting the fix in-place
   and running the test).

## Summary

| ID       | Title                                                | Severity | Status      |
| -------- | ---------------------------------------------------- | -------- | ----------- |
| SEC-001  | Command injection via `name` query in `/api/file-diff` | Critical | Fixed + test |
| SEC-002  | Command injection via repo path in domain-mapping    | High     | Fixed + test |
| SEC-003  | Python code injection via `CLAUDE_PLUGIN_ROOT`       | Critical | Fixed + test |
| SEC-004  | Supply-chain takeover via `CORTEX_PIPELINE_GIT_URL`  | Medium   | Documented (compensating) |
| SEC-005  | Stored XSS in dashboard memory list                  | High     | Fixed + test |
| SEC-006  | `bash -c` re-evaluation of `${CLAUDE_PLUGIN_ROOT}`   | Medium   | Fixed + test |
| SEC-007  | Reranker ONNX model in world-writable `/tmp`         | Low      | Documented |
| CVE-2026-41242 | protobufjs <7.5.5 — arbitrary code execution    | Critical | Pinned via pnpm overrides |
| CVE-2026-41139 | mathjs <15.2.0 — improperly-controlled property setter | High | Upgraded |
| CVE-2026-40897 | mathjs <15.2.0 — unsafe object property setter   | High | Upgraded |
| CVE-2026-6410  | @fastify/static <9.1.1 — path traversal in dirList | Moderate | Upgraded |
| CVE-2026-6414  | @fastify/static <9.1.1 — route guard bypass         | Moderate | Upgraded |
| CVE-2026-42338 | ip-address <10.1.1 — XSS in Address6 HTML          | Moderate | Pinned via pnpm overrides |

After fixes: `pnpm audit --prod` reports `No known vulnerabilities found`.

## Findings

### SEC-001 — Command injection in `/api/file-diff` (CRITICAL)

**File.** `packages/memory-dashboard/src/routes/file-diff.ts:72,76` (pre-fix).

**Vector.** The dashboard route handler interpolated user-supplied `name`
into a shell string:

```ts
raw = execSync(`git diff HEAD -- "${filePath}"`, { cwd: gitRoot, ... });
```

`sanitiseName` rejected only `..` traversal and NUL. It accepted shell
metacharacters such as `;`, `$`, `` ` ``, `|`, `&`, and newline. Because
the path was inside a double-quoted shell context, the payload could break
out and append a new shell command:

```
GET /api/file-diff?name=tracked.txt%22%3Btouch%20%2Ftmp%2FPWNED%3Becho%20%22
```

→ `git diff HEAD -- "tracked.txt";touch /tmp/PWNED;echo ""` → `/tmp/PWNED`
created in the dashboard process's environment (loopback-only, but any
local app or DNS-rebinding browser can reach it).

**CVSS (estimated).** 8.8 (AV:L/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H — local
network, low complexity, full RCE in the dashboard process).

**Fix.** Rewrote `file-diff.ts` to use the canonical frozen-allowlist +
argv-style pattern from
`packages/memory/src/infrastructure/git-diff-exec.ts`:

```ts
execFileSync("git", [subcommand, ...safeArgs], { shell: false, ... });
```

The user-controlled name is now passed as a separate argv element after
`--`, which `git` treats as a literal pathspec — never as a shell token.
`sanitiseName` additionally rejects shell metacharacters as defense in
depth.

**Test.** `packages/memory-dashboard/__tests__/file-diff-security.test.ts`
(17 cases). Falsification verified: reverting to the pre-fix code makes
8/17 tests fail, including the marker-file existence check that proves
shell execution did not occur.

---

### SEC-002 — Command injection in domain-mapping (HIGH)

**File.** `packages/memory/src/shared/domain-mapping.ts:62,266` (pre-fix).

**Vector.** Both helpers shell-interpolated a filesystem path:

```ts
execSync(`git -C "${repoPath}" remote get-url origin`, ...);
execSync(`git -C "${path}" rev-parse --show-toplevel`, ...);
```

`repoPath` came from `readdirSync` of `~/Developments`. **Filesystems
legitimately allow `;`, `$`, `` ` ``, `\n` in directory names.** An
attacker (or any user — including a malicious npm package's
`postinstall` script) who could create a directory named e.g.
`repo";touch /tmp/MARKER;echo "x` inside `~/Developments/` would, on the
next domain-mapping discovery sweep, shell-execute the embedded `touch`.

**CVSS (estimated).** 7.0 (AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H — local
attacker with write to `~/Developments` triggers RCE on next
session-start hook firing).

**Fix.** argv-style invocation:

```ts
execFileSync("git", ["-C", repoPath, "remote", "get-url", "origin"],
             { shell: false, ... });
```

**Test.** `packages/memory/__tests__/shared/domain-mapping-security.test.ts`
(2 cases). Falsification verified: reverting both functions makes both
tests fail with the marker file present.

---

### SEC-003 — Python code injection via `CLAUDE_PLUGIN_ROOT` (CRITICAL)

**File.** `packages/memory/src/hooks/session-start.ts:200-208` (pre-fix).

**Vector.** `autoWirePipeline()` interpolated an env var directly into
Python source:

```ts
spawnSync("python3", ["-c", `
  import json, sys
  sys.path.insert(0, r"${pluginRoot.replace(/\\/g, "/")}")
  from mcp_server.infrastructure.pipeline_discovery import ...
`]);
```

The `r"..."` raw-string literal does not interpret `\`, but a value
containing a `"` closes the literal and the rest is parsed as Python
source. Setting:

```
CLAUDE_PLUGIN_ROOT='"+__import__("os").system("touch /tmp/PWNED")+"'
```

produced:

```python
sys.path.insert(0, r""+__import__("os").system("touch /tmp/PWNED")+"")
```

— Python evaluated the embedded expression (`os.system` → arbitrary
shell) before calling `insert`. CWE-95.

**CVSS (estimated).** 8.5 (AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H — any
process that can set environment variables on the user's session
achieves RCE on the next SessionStart hook firing). Plausible vectors:
malicious shell rc script, compromised CI runner, malicious MCP plugin
post-install.

**Fix.** Pass `pluginRoot` as `sys.argv[1]`, never interpolated into
Python source. argv values are byte strings to Python — never evaluated
as code.

```ts
const PYTHON_AUTOWIRE_SCRIPT = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[1])",
  "...",
].join("\n");
spawnSync("python3", ["-c", PYTHON_AUTOWIRE_SCRIPT, pluginRoot], { shell: false, ... });
```

**Test.** `packages/memory/__tests__/hooks/session-start-security.test.ts`
(2 cases). Falsification of this test was deliberately NOT performed
under sandbox: the falsification step would actually execute injected
Python (`os.system("touch ...")`), which the sandbox correctly refused.
The fix was instead validated by reading the resulting code path: the
malicious env value flows to `argv[1]` only, never to the `-c` source.

---

### SEC-004 — Supply-chain via `CORTEX_PIPELINE_GIT_URL` (MEDIUM, accepted)

**File.** `packages/memory/src/infrastructure/pipeline-installer.ts:225-227`.

**Vector.** `installPipeline` honours `CORTEX_PIPELINE_GIT_URL` env to
override the git URL it clones for the upstream Rust binary. If an
attacker controls the env, they can redirect to a hostile repo whose
`build.rs` runs arbitrary code at `cargo build` time.

**Why not fixed in this PR.** This is the intentional opt-in escape
hatch for fork-development. The threat model assumes the user runs the
plugin install with their own env. Mitigations already in place:

1. `CORTEX_AUTO_INSTALL_PIPELINE=0` opts out entirely (default in CI).
2. Install is gated behind a file-lock with `withInstallLock`.
3. The binary is cached and reused; refreshes require explicit
   `forceRebuild`.

**Recommendation (deferred).** Future hardening: pin the URL to a
domain allowlist (`github.com/cdeust/*`), or require a Sigstore
signature on the cloned `Cargo.toml` head commit. Tracked as a
documented follow-up; not blocking the security-audit branch.

---

### SEC-005 — Stored XSS in dashboard memory list (HIGH)

**File.** `packages/memory-dashboard/src/static/index.html:176-189` (pre-fix).

**Vector.** `loadMemories()` interpolated user-controllable memory
fields directly into HTML via `innerHTML`:

```js
list.innerHTML = (data.memories ?? []).map(m => `
  <div class="memory-item">${m.content}<div>...${m.domain}</div></div>
`).join('');
```

Memory `content` is attacker-controllable: any tool agent that calls
`cortex:remember({content:"<img src=x onerror=alert(1)>"})` (a malicious
MCP plugin, a compromised ingestion pipeline, an external import via
`detectExternalSources`) plants a stored payload. When the dashboard
fetches it, the script executes inside the loopback origin.

**CVSS (estimated).** 6.1 (AV:L/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N —
loopback-bound but any local app or DNS-rebound browser tab can read
the resulting page).

**Fix.** Replaced `innerHTML` interpolation with DOM API
(`document.createElement` + `textContent`). `textContent` never parses
HTML.

**Test.** `packages/memory-dashboard/__tests__/dashboard-xss.test.ts`
(3 cases). Asserts:

1. No `.innerHTML =` assignments remain in the dashboard HTML.
2. `loadMemories` uses `createTextNode` / `textContent`.
3. No `document.write`, `eval`, or `new Function` in the script.

Falsification verified: reverting to the `innerHTML` form makes 2/3
tests fail.

---

### SEC-006 — `bash -c` re-evaluation in plugin `.mcp.json` (MEDIUM)

**File.** `plugins/memory/.mcp.json`, `plugins/reasoning/.mcp.json`,
`plugins/prd/.mcp.json`, `plugins/codebase/.mcp.json` (pre-fix).

**Vector.** Each plugin manifest used:

```json
{ "command": "bash",
  "args": ["-c", "exec node \"${CLAUDE_PLUGIN_ROOT}/.../index.js\""] }
```

Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` into the args
verbatim, then bash re-evaluates the resulting `-c` string. If the
install path ever contained shell metacharacters (`$`, `` ` ``,
`$(...)`) — e.g., compromised marketplace, attacker-symlinked install
dir — the substitution would execute.

**Why a real risk.** The plugin install path is normally
`~/.claude/plugins/cache/<owner>__<repo>/<plugin>` (alphanumeric +
`__`), but the system has no enforced regex on path components.

**Fix.**

- Memory, reasoning, prd plugins: argv form. `command: "node"`,
  `args: ["${CLAUDE_PLUGIN_ROOT}/.../index.js"]`. The OS passes the
  argv element to `node` verbatim — bytes, not source.
- Codebase plugin (which had bash conditional fallback logic): added
  a hand-written `plugins/codebase/scripts/launch.sh` that takes the
  plugin root as `$1`. argv values are never re-evaluated as shell
  source.

**Test.** `packages/memory-dashboard/__tests__/plugin-mcp-config.test.ts`
(9 cases). Falsification verified: reverting one plugin to
`bash -c "...${CLAUDE_PLUGIN_ROOT}..."` makes 2/9 tests fail.

---

### SEC-007 — Reranker ONNX model in world-writable `/tmp` (LOW, documented)

**File.** `packages/memory/src/recall/reranker.ts:204-208`.

**Observation.** The FlashRank ONNX model is loaded from
`/tmp/ms-marco-MiniLM-L-12-v2/flashrank-MiniLM-L-12-v2_Q.onnx`. `/tmp`
is world-writable on POSIX; any local user can plant a malicious ONNX
file at that path.

**Risk classification.** ONNX runtime executes only ML ops (no `Exec`
node, no shell-out). The malicious model produces incorrect inference
results (low-quality reranking) but does not execute arbitrary code.
Severity: low.

**Recommendation (deferred).** Move the cache to per-user
`~/.cache/agentic-ai/flashrank/` and fail-closed if the file is
group/world-writable. Tracked as a documented follow-up; the parity
contract (`benchmark 2026-05-06`) currently locks the path to `/tmp`
to match Python flashrank behaviour. A follow-up PR can add a
checksum verification step.

---

## Dependency CVEs — pnpm audit advisories

All advisories flagged by `pnpm audit --prod` were addressed.

### CVE-2026-41242 — protobufjs <7.5.5 (CRITICAL)

Transitive: `@xenova/transformers > onnxruntime-web > onnx-proto > protobufjs`.

Exploit class: arbitrary code execution via crafted Protocol Buffer
input. In our codebase, protobufjs is reached only when
onnxruntime-web parses ONNX models — which we do NOT use directly
(reranker uses onnxruntime-node). However, transitive import paths
mean the package is bundled and reachable in principle. **Pinned
≥7.5.5 via `pnpm.overrides`.**

### CVE-2026-41139 + CVE-2026-40897 — mathjs <15.2.0 (HIGH)

Direct: `packages/prd-pipeline/packages/benchmark`. Used in
`math-oracle.ts::evaluate(expression)` for benchmark KPI calibration.
Even though our caller passes only static benchmark expressions (not
user input), the upgrade is non-API-breaking for `evaluate()` (verified
by `pnpm --filter @agentic/prd-benchmark... build`). **Upgraded to
^15.2.0.**

### CVE-2026-6410 + CVE-2026-6414 — @fastify/static <9.1.1 (MODERATE)

Direct: `packages/memory-dashboard`. Path traversal in directory
listing + route-guard bypass via percent-encoded path separators.
Memory-dashboard does NOT enable `list: true`, so CVE-2026-6410 is
not directly exploitable. Route guards + loopback-only binding mean
CVE-2026-6414 has no realistic vector either. Upgraded as defense in
depth. **Upgraded to ^9.1.1.**

### CVE-2026-42338 — ip-address <10.1.1 (MODERATE)

Transitive: `@modelcontextprotocol/sdk > express-rate-limit > ip-address`.
XSS in IPv6-Address HTML emission. We do not call the affected
methods. **Pinned ≥10.1.1 via `pnpm.overrides`** as defense in depth.

---

## Out of scope (acknowledged)

- **MCP transport DoS via huge JSON payloads.** Not directly exploited
  in our code (the SDK handles framing), but a rate-limit / max-payload
  hook on the MCP server is a future hardening item.
- **Memory-tool.sh script.** Lives in the upstream zetetic-team-subagents
  repo, not in this monorepo. Audited transitively only — argv-style
  invocation in `backend.ts` is sufficient defence on our end.
- **`/tmp`-based filelocks** (`pipeline-install-lock.ts`). Standard
  unix lock pattern; symlink-attack class is mitigated by `O_EXCL`.

## Verification commands

```sh
# 0 high/critical advisories.
pnpm audit --prod

# All security regression tests.
pnpm --filter @agentic/memory-dashboard test --run \
  __tests__/file-diff-security.test.ts \
  __tests__/dashboard-xss.test.ts \
  __tests__/plugin-mcp-config.test.ts

pnpm --filter @agentic/memory test --run \
  __tests__/shared/domain-mapping-security.test.ts \
  __tests__/hooks/session-start-security.test.ts
```

Result (2026-05-06):
- pnpm audit → No known vulnerabilities found.
- 33 security regression tests pass across 5 files.
- One pre-existing failure in `embedding-engine.test.ts` is unrelated
  to this audit (no diff to that file or its source dependencies).
