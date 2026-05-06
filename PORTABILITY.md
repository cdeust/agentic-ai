# Portability Audit — Multi-Environment Portability

**Invariant frame (Lamport):** every path, binary name, and clock reading used for
correctness must hold across `(Linux, macOS, Windows) × (Node 20.x, 22.x, 24.x) ×
(CLI vs MCP-stdio vs sandboxed)`.  Hardcoded POSIX assumptions are latent correctness
violations whose failure mode is delayed and environment-specific.

---

## Findings and Fixes

### FIX-1 — HARDCODED-PATH: `FLASHRANK_CACHE_DIR = "/tmp"`

| | |
|---|---|
| **File** | `packages/memory/src/recall/reranker.ts:204` |
| **Category** | HARDCODED-PATH |
| **Severity** | Critical — Windows has no `/tmp`; model would never be found |
| **Root cause** | Literal `/tmp` mirroring Python's `flashrank.Config.default_cache_dir` without porting the `tempfile.gettempdir()` call |
| **Fix** | Replace with `process.env["FLASHRANK_CACHE_DIR"] ?? os.tmpdir()`. Resolution order: explicit env-var override (CI / non-default install), then `os.tmpdir()` which resolves to `%TEMP%` on Windows and `/tmp` on POSIX, exactly mirroring Python's `tempfile.gettempdir()`. |
| **Invariant preserved** | `FLASHRANK_CACHE_DIR` is always an absolute, platform-legal writable path |
| **Source** | Python docs — `tempfile.gettempdir()` is the exact equivalent of `os.tmpdir()` |

---

### FIX-2 — POSIX-ONLY-ENV: `process.env["HOME"]` in `resolveExistingPaths`

| | |
|---|---|
| **File** | `packages/memory/src/recall/handlers/validate-memory-handler.ts:147` |
| **Category** | POSIX-ONLY-ENV |
| **Severity** | High — `HOME` is undefined on Windows; tilde expansion produces `"~"` literal, breaking all `~/…` path resolution |
| **Root cause** | Direct `process.env["HOME"]` access instead of the portable `os.homedir()` API |
| **Fix** | Replace `process.env["HOME"]` with `os.homedir()`. Node.js `os.homedir()` uses `GetUserProfileDirectory` on Win32, `HOME` on POSIX. |
| **Invariant preserved** | `homeDir` is always a valid absolute path; tilde expansion always produces a real directory |
| **Source** | Node.js docs — `os.homedir()` |

---

### FIX-3 — POSIX-ONLY-COMMAND: Hardcoded `"python3"` in session-start.ts

| | |
|---|---|
| **File** | `packages/memory/src/hooks/session-start.ts` lines 103, 147, 198, 312 |
| **Category** | POSIX-ONLY-COMMAND |
| **Severity** | High — Windows ships `python` (Microsoft Store launcher), not `python3`; all Python subprocesses fail on Windows |
| **Root cause** | Literal `"python3"` passed directly to `spawnSync`/`spawn` |
| **Fix** | Introduce module-level constant `PYTHON_BIN = process.env["CORTEX_PYTHON_BIN"] ?? (process.platform === "win32" ? "python" : "python3")`. All four call sites now reference `PYTHON_BIN`. |
| **Invariant preserved** | The Python binary name resolves on all three platforms; CI can override via `CORTEX_PYTHON_BIN` |
| **Source** | CPython docs — on Windows the Microsoft Store launcher registers `python`, not `python3` |

---

### FIX-4 — PATH-SEPARATOR: POSIX `:` hardcoded in PATH construction

| | |
|---|---|
| **File** | `packages/memory/src/infrastructure/pipeline-installer.ts:238` |
| **Category** | PATH-SEPARATOR |
| **Severity** | High — Windows uses `;` as the PATH delimiter; Cargo binary would not be found by subsequent shell commands |
| **Root cause** | Template literal `` `${CARGO_HOME_BIN}:${process.env["PATH"] ?? ""}` `` hardcodes the POSIX PATH separator |
| **Fix** | Replace `:` with `path.delimiter` which is `":"` on POSIX and `";"` on Windows. |
| **Invariant preserved** | PATH is correctly delimited on all platforms; Cargo binary is reachable |
| **Source** | Node.js docs — `path.delimiter` |

---

### FIX-5 — POSIX-ONLY-COMMAND: `lsof` in `killPort` and `open`/`xdg-open` in `openInBrowser`

| | |
|---|---|
| **File** | `packages/memory-dashboard/src/launcher.ts` lines 66, 147–148 |
| **Category** | POSIX-ONLY-COMMAND |
| **Severity** | Medium — `lsof` does not exist on Windows; `xdg-open` is Linux-only |
| **Root cause** | `killPort` used `lsof -t -i :<port>` unconditionally; `openInBrowser` dispatched only `darwin`/`xdg-open` |
| **Fix** | (a) `killPort`: gate by `process.platform === "win32"` → use `netstat -ano -p TCP` + parse PID column; POSIX path unchanged. (b) `openInBrowser`: add `win32` branch → `cmd /c start "" <url>`. |
| **Invariant preserved** | `killPort` always resolves; `openInBrowser` issues the correct browser-open command on all three platforms; security guard (loopback-only regex) unchanged |
| **Source** | Windows docs — `netstat -ano`, `cmd /c start`; freedesktop.org — `xdg-open(1)` |

---

### FIX-6 — MONOTONIC-CLOCK: `Date.now()` for elapsed timing in `telemetry-wrap.ts`

| | |
|---|---|
| **File** | `packages/memory/src/shared/telemetry-wrap.ts:80,92` |
| **Category** | MONOTONIC-CLOCK |
| **Severity** | Low-Medium — `Date.now()` is non-monotonic; NTP step adjustments can produce negative elapsed times, corrupting latency histograms |
| **Root cause** | Port of Python `time.perf_counter()` used `Date.now()` instead of the equivalent `performance.now()` |
| **Fix** | Replace `Date.now()` with `performance.now()` for the `t0` capture and elapsed computation. `performance.now()` is a monotonic high-resolution timer (Node.js ≥ 12). |
| **Invariant preserved** | `latencyMs` is always ≥ 0; clock skew from NTP cannot produce negative latency samples |
| **Source** | Node.js docs — `performance.now()` uses a monotonic clock; Lamport (1978) §3 — elapsed measurements must use monotonic clocks |

---

## Residual Items (documented, not fixed in this pass)

### RES-1 — POSIX-ONLY-COMMAND: `python3` in `packages/reasoning/hooks/hooks.json`

The hook config at line 9 hardcodes `python3 ${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-secret-shield.py`.
JSON hook configs are consumed by the Claude Code runtime, which does not perform variable
substitution of the binary name. The correct resolution is for the hook to be wrapped in
a thin shell script that resolves the binary:

```sh
#!/usr/bin/env sh
python3 "$CLAUDE_PLUGIN_ROOT/hooks/pre-tool-secret-shield.py" "$@" \
  || python "$CLAUDE_PLUGIN_ROOT/hooks/pre-tool-secret-shield.py" "$@"
```

This is deferred because (a) the hooks are POSIX-targeted by design, (b) Claude Code
itself does not officially support Windows, and (c) the fix requires a new `.sh` wrapper
file outside this PR's scope.

### RES-2 — POSIX-ONLY-COMMAND: `sh` in `pipeline-install-rust.ts`

`installRustToolchain` uses `sh` to execute the `rustup-init.sh` download script.
This is intentionally POSIX-only: the rustup installer for Windows ships as an `.exe`
binary, not a shell script. Any Windows Rust installation path must use a different
strategy (direct `.exe` download). This is documented as a known platform gate in
the function's contract.

### RES-3 — HARDCODED-PATH: machine-specific XMR paths in calibration JSON files

`packages/prd-pipeline/packages/benchmark/calibration/data/gate-calibration-K100*.json`
contain absolute paths under `/Users/cdeust/…`. These are data files recording
benchmark calibration results produced on one machine; they are read-only reference
data, not code paths resolved at runtime. They do not affect portability of running
code, only the ability to re-run benchmark calibration from the same machine.
Documented; not in scope.

### RES-4 — HARDCODED-PATH: example path in `locomo-loader.ts`

`packages/parity-benchmark/src/locomo-loader.ts:129` has a hardcoded fallback path
`/Users/cdeust/Developments/cortex/benchmarks/locomo/locomo10.json`. This is a
developer-machine fallback for a data file not committed to the repo. The code path
is never reached in CI (the env var `LOCOMO_DATASET` gates it). Documented;
not in scope.

---

## Platform-Gate Summary

| Platform | Invariant |
|---|---|
| Windows | `FLASHRANK_CACHE_DIR` → `%TEMP%`; `HOME` → `os.homedir()`; Python → `python`; PATH separator → `;`; browser → `cmd /c start`; port-kill → `netstat -ano`; Rust install → explicitly not supported (RES-2) |
| macOS | All POSIX defaults; browser → `open`; port-kill → `lsof` |
| Linux | All POSIX defaults; browser → `xdg-open`; port-kill → `lsof` |

## Node Version Compatibility

No `import.meta.dirname` (Node 22+ only) was introduced. All path resolution uses
`fileURLToPath(import.meta.url)` which is available from Node 12+. The workspace
`"engines": { "node": ">=20.0.0" }` field is satisfied by all fixes.

`performance.now()` is available from Node 12+ (exposed via the `perf_hooks` module
and as a global in Node 16+). No compatibility gap.
