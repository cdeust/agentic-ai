#!/usr/bin/env python3
"""
parity-test.py — Severe falsification test for the TS port of memory-mcp-server.py.

Protocol:
  - Spawn both servers as subprocesses with stdio attached.
  - Drive each server through Tests 1–6 in sequence.
  - Capture verbatim request + both responses for each test.
  - Diff semantically; emit PASS/FAIL per test with classification.

No mocks. No shortcuts. Real subprocesses. Real JSON-RPC over stdio.
"""

import json
import os
import subprocess
import sys
import textwrap
import time
import threading
import tempfile
import shutil
from typing import Any

# ── Server commands ───────────────────────────────────────────────────────────

PYTHON_CMD = [
    sys.executable,
    "/Users/cdeust/Developments/zetetic-team-subagents/tools/memory-mcp-server.py",
]

TS_CMD = [
    "node",
    "/Users/cdeust/Developments/agentic-ai/worktrees/port-fix/zetetic-mcp-server-port-2026-05-06/packages/mcp-servers/reasoning/dist/index.js",
]

BACKEND_SH = "/Users/cdeust/Developments/zetetic-team-subagents/tools/memory-tool.sh"

# ── Colours ───────────────────────────────────────────────────────────────────

GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

def ok(s):  return f"{GREEN}{s}{RESET}"
def fail(s): return f"{RED}{BOLD}{s}{RESET}"
def warn(s): return f"{YELLOW}{s}{RESET}"
def bold(s): return f"{BOLD}{s}{RESET}"

# ── Server wrapper ────────────────────────────────────────────────────────────

class Server:
    """Wraps a server subprocess; provides send/recv over stdio."""

    def __init__(self, name: str, cmd: list[str], env: dict | None = None):
        self.name = name
        real_env = os.environ.copy()
        real_env["MEMORY_BACKEND_CMD"] = BACKEND_SH
        if env:
            real_env.update(env)
        self.proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=real_env,
        )
        # stderr drain thread so it does not block
        self._stderr_lines: list[str] = []
        self._drain = threading.Thread(target=self._drain_stderr, daemon=True)
        self._drain.start()
        # Give the server a moment to start
        time.sleep(0.3)

    def _drain_stderr(self):
        assert self.proc.stderr is not None
        for line in self.proc.stderr:
            self._stderr_lines.append(line.decode(errors="replace").rstrip())

    def send(self, obj: dict) -> dict:
        """Send a JSON-RPC request; return parsed response."""
        line = (json.dumps(obj) + "\n").encode()
        assert self.proc.stdin is not None
        assert self.proc.stdout is not None
        self.proc.stdin.write(line)
        self.proc.stdin.flush()
        raw = self.proc.stdout.readline()
        if not raw:
            raise RuntimeError(f"{self.name}: server closed stdout unexpectedly")
        return json.loads(raw.decode())

    def send_raw(self, raw_bytes: bytes) -> dict:
        """Send raw bytes; return parsed response."""
        assert self.proc.stdin is not None
        assert self.proc.stdout is not None
        self.proc.stdin.write(raw_bytes)
        self.proc.stdin.flush()
        raw = self.proc.stdout.readline()
        if not raw:
            raise RuntimeError(f"{self.name}: server closed stdout unexpectedly")
        return json.loads(raw.decode())

    def send_multi(self, requests: list[dict]) -> list[dict]:
        """Send many requests at once (no inter-send wait); collect all responses."""
        assert self.proc.stdin is not None
        assert self.proc.stdout is not None
        payload = b"".join((json.dumps(r) + "\n").encode() for r in requests)
        self.proc.stdin.write(payload)
        self.proc.stdin.flush()
        responses = []
        for _ in requests:
            raw = self.proc.stdout.readline()
            if not raw:
                break
            responses.append(json.loads(raw.decode()))
        return responses

    def stop(self):
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        self.proc.wait(timeout=5)

# ── Comparison helpers ────────────────────────────────────────────────────────

def deep_diff(a: Any, b: Any, path: str = "") -> list[str]:
    """Return list of differences (path: expected vs actual)."""
    diffs = []
    if type(a) != type(b):
        diffs.append(f"{path}: type {type(a).__name__} vs {type(b).__name__}")
        return diffs
    if isinstance(a, dict):
        all_keys = set(a) | set(b)
        for k in sorted(all_keys):
            sub = f"{path}.{k}" if path else k
            if k not in a:
                diffs.append(f"{sub}: missing in Python, present in TS: {b[k]!r}")
            elif k not in b:
                diffs.append(f"{sub}: present in Python, missing in TS: {a[k]!r}")
            else:
                diffs.extend(deep_diff(a[k], b[k], sub))
    elif isinstance(a, list):
        if len(a) != len(b):
            diffs.append(f"{path}: list len {len(a)} vs {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            diffs.extend(deep_diff(x, y, f"{path}[{i}]"))
    else:
        if a != b:
            diffs.append(f"{path}: Python={a!r}  TS={b!r}")
    return diffs

def print_side_by_side(label: str, req: dict, py_resp: dict, ts_resp: dict):
    print(f"\n{bold('─'*70)}")
    print(bold(label))
    print(f"  REQUEST : {json.dumps(req)}")
    print(f"  PYTHON  : {json.dumps(py_resp)}")
    print(f"  TS      : {json.dumps(ts_resp)}")

# ── Result accumulator ────────────────────────────────────────────────────────

results: list[tuple[str, str, list[str]]] = []  # (test_name, status, diffs)

def record(name: str, diffs: list[str]):
    if diffs:
        results.append((name, "FAIL", diffs))
        print(fail(f"  RESULT: FAIL"))
        for d in diffs:
            print(f"    {RED}DIFF{RESET}: {d}")
    else:
        results.append((name, "PASS", []))
        print(ok("  RESULT: PASS"))

# ── Test 1: cold-start / initialize ──────────────────────────────────────────

def test1_initialize(py: Server, ts: Server):
    print(bold("\n╔══════════════════════════════════════════════════════════════╗"))
    print(bold("║  TEST 1 — Cold-start / initialize parity                     ║"))
    print(bold("╚══════════════════════════════════════════════════════════════╝"))

    req = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "parity-test", "version": "1.0"},
        },
    }

    py_resp = py.send(req)
    ts_resp = ts.send(req)

    print_side_by_side("initialize", req, py_resp, ts_resp)

    diffs = []
    # Fields that must match exactly per the protocol
    for field in ["protocolVersion", "serverInfo", "capabilities"]:
        py_val = py_resp.get("result", {}).get(field)
        ts_val = ts_resp.get("result", {}).get(field)
        sub_diffs = deep_diff(py_val, ts_val, f"result.{field}")
        diffs.extend(sub_diffs)

    # Also check top-level jsonrpc field
    diffs.extend(deep_diff(py_resp.get("jsonrpc"), ts_resp.get("jsonrpc"), "jsonrpc"))

    record("Test 1: initialize parity", diffs)

# ── Test 2: tools/list parity ─────────────────────────────────────────────────

def test2_tools_list(py: Server, ts: Server):
    print(bold("\n╔══════════════════════════════════════════════════════════════╗"))
    print(bold("║  TEST 2 — tools/list parity (full schema comparison)         ║"))
    print(bold("╚══════════════════════════════════════════════════════════════╝"))

    req = {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}

    py_resp = py.send(req)
    ts_resp = ts.send(req)

    print_side_by_side("tools/list", req, py_resp, ts_resp)

    py_tools = {t["name"]: t for t in (py_resp.get("result") or {}).get("tools", [])}
    ts_tools = {t["name"]: t for t in (ts_resp.get("result") or {}).get("tools", [])}

    diffs = []

    # Check tool names present
    diffs.extend(deep_diff(sorted(py_tools.keys()), sorted(ts_tools.keys()), "tool_names"))

    # Deep-compare each tool definition
    for tool_name in py_tools:
        if tool_name not in ts_tools:
            diffs.append(f"Tool '{tool_name}': present in Python, missing in TS")
            continue
        py_t = py_tools[tool_name]
        ts_t = ts_tools[tool_name]

        # Compare every field
        for field in ["name", "description"]:
            diffs.extend(deep_diff(py_t.get(field), ts_t.get(field), f"{tool_name}.{field}"))

        # Compare inputSchema deeply — this is the key falsifier
        py_schema = py_t.get("inputSchema", {})
        ts_schema = ts_t.get("inputSchema", {})
        diffs.extend(deep_diff(py_schema, ts_schema, f"{tool_name}.inputSchema"))

    record("Test 2: tools/list schema parity", diffs)
    return py_tools, ts_tools

# ── Test 3: per-command tools/call parity ─────────────────────────────────────

def test3_tools_call(py: Server, ts: Server, tmp_root: str):
    print(bold("\n╔══════════════════════════════════════════════════════════════╗"))
    print(bold("║  TEST 3 — Per-command tools/call parity (15 commands)        ║"))
    print(bold("╚══════════════════════════════════════════════════════════════╝"))

    # Set MEMORY_ROOT to temp dir so both servers write to the same place
    # Both servers were spawned with the same env so they share state.
    # Use a unique path under tmp_root.
    mem_path = os.path.join(tmp_root, "test-memory.md")

    # The 15 command invocations — realistic arguments
    memory_commands = [
        # 1. view root directory listing
        {"name": "memory", "arguments": {"command": "view", "path": "/memories"}},
        # 2. create a file
        {"name": "memory", "arguments": {"command": "create", "path": "/memories/parity-test.md", "file_text": "# Parity Test\n\nLine one.\nLine two.\n"}},
        # 3. view the created file
        {"name": "memory", "arguments": {"command": "view", "path": "/memories/parity-test.md"}},
        # 4. view with range
        {"name": "memory", "arguments": {"command": "view", "path": "/memories/parity-test.md", "view_range": [1, 2]}},
        # 5. str_replace
        {"name": "memory", "arguments": {"command": "str_replace", "path": "/memories/parity-test.md", "old_str": "Line one.", "new_str": "Line ONE (replaced)."}},
        # 6. insert
        {"name": "memory", "arguments": {"command": "insert", "path": "/memories/parity-test.md", "insert_line": 0, "insert_text": "# Prepended Header\n"}},
        # 7. delete file (at end of memory commands so it doesn't break 5/6)
        # We'll do delete last for memory
    ]

    extensions_commands = [
        # 8. scopes
        {"name": "memory_extensions", "arguments": {"command": "scopes"}},
        # 9. search
        {"name": "memory_extensions", "arguments": {"command": "search", "query": "Parity"}},
        # 10. preamble
        {"name": "memory_extensions", "arguments": {"command": "preamble"}},
        # 11. sync-status
        {"name": "memory_extensions", "arguments": {"command": "sync-status"}},
        # 12. ttl-sweep dry-run
        {"name": "memory_extensions", "arguments": {"command": "ttl-sweep", "dry_run": True}},
        # 13. audit
        {"name": "memory_extensions", "arguments": {"command": "audit"}},
        # 14. drain-sync
        {"name": "memory_extensions", "arguments": {"command": "drain-sync", "limit": 1}},
        # 15. rename
        {"name": "memory", "arguments": {"command": "rename", "old_path": "/memories/parity-test.md", "new_path": "/memories/parity-test-renamed.md"}},
        # And delete to clean up
        {"name": "memory", "arguments": {"command": "delete", "path": "/memories/parity-test-renamed.md"}},
    ]

    all_commands = memory_commands + extensions_commands
    overall_diffs: list[str] = []

    for idx, call in enumerate(all_commands, 1):
        req = {"jsonrpc": "2.0", "id": 100 + idx, "method": "tools/call", "params": call}
        print(f"\n  [{idx:02d}] tools/call {call['name']} command={call['arguments'].get('command')}")
        print(f"       REQUEST: {json.dumps(req)}")

        # Python runs first, TS second. They share the same MEMORY_ROOT via env.
        # But we need BOTH to run the command against the SAME state.
        # Since they are separate processes, each call to Python mutates state
        # and then TS must see the same state. To compare them, we run the
        # command on Python, record the output; THEN run the SAME command on TS
        # and compare the outputs.
        #
        # For stateful commands (create/str_replace/insert/rename/delete) the
        # second call (TS) will fail because the mutation already happened.
        # To handle this properly: run each command independently on both.
        # We must reset state between Python and TS calls.
        #
        # Strategy: run the command on Python first, then undo any mutation,
        # then run on TS. OR: accept that for mutating commands the TS call
        # will get a different backend response (state changed), and only compare
        # the STRUCTURE (content[0].type, isError key presence) rather than text.
        #
        # Strict approach: run each command on Python, capture response;
        # then run the same command on TS, capture response;
        # compare structure AND text where the command is idempotent.

        py_resp = py.send(req)
        ts_resp = ts.send(req)

        print(f"       PYTHON:  {json.dumps(py_resp)}")
        print(f"       TS:      {json.dumps(ts_resp)}")

        # Structural comparison (always required)
        cmd_diffs: list[str] = []

        py_result = py_resp.get("result", {})
        ts_result = ts_resp.get("result", {})

        # Check isError key presence matches
        py_is_err = py_result.get("isError", False)
        ts_is_err = ts_result.get("isError", False)
        if py_is_err != ts_is_err:
            cmd_diffs.append(f"isError mismatch: Python={py_is_err} TS={ts_is_err}")

        # Check content structure
        py_content = py_result.get("content", [])
        ts_content = ts_result.get("content", [])
        if len(py_content) != len(ts_content):
            cmd_diffs.append(f"content length: Python={len(py_content)} TS={len(ts_content)}")
        elif py_content and ts_content:
            # content[0].type must match
            if py_content[0].get("type") != ts_content[0].get("type"):
                cmd_diffs.append(f"content[0].type: Python={py_content[0].get('type')!r} TS={ts_content[0].get('type')!r}")
            # For idempotent read commands, compare text exactly
            is_mutating = call["arguments"].get("command") in {
                "create", "str_replace", "insert", "rename", "delete"
            }
            if not is_mutating:
                py_text = py_content[0].get("text", "")
                ts_text = ts_content[0].get("text", "")
                if py_text != ts_text:
                    cmd_diffs.append(
                        f"content[0].text differs:\n"
                        f"         Python={py_text[:200]!r}\n"
                        f"         TS    ={ts_text[:200]!r}"
                    )

        cmd_name = f"{call['name']}.{call['arguments'].get('command')}"
        if cmd_diffs:
            print(fail(f"       FAIL: {', '.join(cmd_diffs[:1])}"))
        else:
            print(ok("       PASS"))
        overall_diffs.extend([f"[{cmd_name}] {d}" for d in cmd_diffs])

    record("Test 3: tools/call per-command parity", overall_diffs)

# ── Test 4: validation-error parity ──────────────────────────────────────────

def test4_validation_error(py: Server, ts: Server):
    print(bold("\n╔══════════════════════════════════════════════════════════════╗"))
    print(bold("║  TEST 4 — Validation-error parity                            ║"))
    print(bold("╚══════════════════════════════════════════════════════════════╝"))

    cases = [
        # invalid command enum value
        {
            "label": "invalid command enum",
            "req": {
                "jsonrpc": "2.0", "id": 200,
                "method": "tools/call",
                "params": {"name": "memory", "arguments": {"command": "INVALID_CMD"}},
            },
        },
        # missing required 'command' field
        {
            "label": "missing required command field",
            "req": {
                "jsonrpc": "2.0", "id": 201,
                "method": "tools/call",
                "params": {"name": "memory", "arguments": {"path": "/memories/x.md"}},
            },
        },
        # wrong type for insert_line (string instead of integer)
        {
            "label": "wrong type for insert_line",
            "req": {
                "jsonrpc": "2.0", "id": 202,
                "method": "tools/call",
                "params": {"name": "memory", "arguments": {"command": "insert", "path": "/memories/x.md", "insert_line": "not-an-int", "insert_text": "x"}},
            },
        },
    ]

    overall_diffs: list[str] = []

    for case in cases:
        req = case["req"]
        label = case["label"]
        print(f"\n  CASE: {label}")
        print(f"  REQUEST: {json.dumps(req)}")

        py_resp = py.send(req)
        ts_resp = ts.send(req)

        print(f"  PYTHON:  {json.dumps(py_resp)}")
        print(f"  TS:      {json.dumps(ts_resp)}")

        case_diffs: list[str] = []

        # Both must produce a response (not crash)
        if "result" not in py_resp and "error" not in py_resp:
            case_diffs.append("Python: no result or error in response")
        if "result" not in ts_resp and "error" not in ts_resp:
            case_diffs.append("TS: no result or error in response")

        # Error shape classification: is it a JSON-RPC error or a tool-result with isError?
        py_is_rpc_err = "error" in py_resp
        ts_is_rpc_err = "error" in ts_resp
        py_is_tool_err = (py_resp.get("result") or {}).get("isError", False)
        ts_is_tool_err = (ts_resp.get("result") or {}).get("isError", False)

        # Critical: both must agree on whether it's a tool-level error vs RPC error
        if py_is_rpc_err != ts_is_rpc_err:
            case_diffs.append(
                f"RPC-error vs tool-error shape mismatch: "
                f"Python rpc_err={py_is_rpc_err} tool_err={py_is_tool_err}  "
                f"TS rpc_err={ts_is_rpc_err} tool_err={ts_is_tool_err}"
            )
        if py_is_tool_err != ts_is_tool_err:
            case_diffs.append(
                f"tool isError mismatch: Python={py_is_tool_err} TS={ts_is_tool_err}"
            )

        if case_diffs:
            print(fail(f"  FAIL: {case_diffs[0]}"))
        else:
            print(ok("  PASS"))
        overall_diffs.extend([f"[{label}] {d}" for d in case_diffs])

    record("Test 4: validation-error parity", overall_diffs)

# ── Test 5: lazy env-var resolution (MEMORY_BACKEND_CMD unset) ────────────────

def test5_env_unset():
    print(bold("\n╔══════════════════════════════════════════════════════════════╗"))
    print(bold("║  TEST 5 — Lazy env-var resolution: MEMORY_BACKEND_CMD unset  ║"))
    print(bold("╚══════════════════════════════════════════════════════════════╝"))

    # Spawn fresh instances with MEMORY_BACKEND_CMD unset.
    # Python hard-codes BACKEND_CMD from _SCRIPT_DIR at module load;
    # TS resolves it lazily at each call from DEFAULT_BACKEND_CMD.
    # Both should resolve to a valid path — the default points to the same
    # memory-tool.sh. We want to confirm the behaviour under unset is equivalent.

    env_no_cmd = os.environ.copy()
    env_no_cmd.pop("MEMORY_BACKEND_CMD", None)

    py2 = Server("py-noenv", PYTHON_CMD, env={"MEMORY_BACKEND_CMD": ""})
    ts2 = Server("ts-noenv", TS_CMD,    env={"MEMORY_BACKEND_CMD": ""})

    # Send initialize first (required handshake)
    init_req = {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}
    py2.send(init_req)
    ts2.send(init_req)

    # Now send a tools/call — both should fail because BACKEND_CMD is ""
    req = {
        "jsonrpc": "2.0", "id": 300,
        "method": "tools/call",
        "params": {"name": "memory", "arguments": {"command": "view", "path": "/memories"}},
    }

    print(f"  REQUEST: {json.dumps(req)}")

    py_resp = py2.send(req)
    ts_resp = ts2.send(req)

    print(f"  PYTHON:  {json.dumps(py_resp)}")
    print(f"  TS:      {json.dumps(ts_resp)}")

    py2.stop()
    ts2.stop()

    diffs: list[str] = []

    # Both servers must behave identically regardless of what that behaviour is.
    # When MEMORY_BACKEND_CMD="", Python ignores the env var and uses its
    # hardcoded _SCRIPT_DIR path; TS (after the empty-string guard fix) also
    # falls back to DEFAULT_BACKEND_CMD.  If DEFAULT_BACKEND_CMD resolves to a
    # valid path on this machine, both succeed.  If not, both fail.
    # The parity condition is: isError must match between the two servers.
    py_is_err = (py_resp.get("result") or {}).get("isError", False)
    ts_is_err = (ts_resp.get("result") or {}).get("isError", False)
    if py_is_err != ts_is_err:
        diffs.append(f"isError mismatch on empty BACKEND_CMD: Python={py_is_err} TS={ts_is_err}")

    # Both must produce same error shape (both tool-result, not JSON-RPC error)
    py_is_rpc = "error" in py_resp
    ts_is_rpc = "error" in ts_resp
    if py_is_rpc != ts_is_rpc:
        diffs.append(f"Error shape mismatch: Python rpc_err={py_is_rpc} TS rpc_err={ts_is_rpc}")

    record("Test 5: env-var unset parity", diffs)

# ── Test 6: concurrency — 5 rapid requests, ordering + framing ───────────────

def test6_concurrency(py: Server, ts: Server):
    print(bold("\n╔══════════════════════════════════════════════════════════════╗"))
    print(bold("║  TEST 6 — Concurrency: 5 rapid requests, ordering + framing  ║"))
    print(bold("╚══════════════════════════════════════════════════════════════╝"))

    requests = [
        {"jsonrpc": "2.0", "id": 400 + i, "method": "tools/call",
         "params": {"name": "memory_extensions", "arguments": {"command": "scopes"}}}
        for i in range(5)
    ]

    print(f"  Sending {len(requests)} rapid requests to each server")

    py_resps = py.send_multi(requests)
    ts_resps = ts.send_multi(requests)

    print(f"  Python got {len(py_resps)} responses")
    print(f"  TS got     {len(ts_resps)} responses")

    diffs: list[str] = []

    # Must receive exactly 5 responses from each
    if len(py_resps) != 5:
        diffs.append(f"Python: expected 5 responses, got {len(py_resps)}")
    if len(ts_resps) != 5:
        diffs.append(f"TS: expected 5 responses, got {len(ts_resps)}")

    # IDs must be preserved and in order (per JSON-RPC, responses can arrive
    # out of order, but for stdio single-threaded servers they should be in order)
    for i, (py_r, ts_r) in enumerate(zip(py_resps, ts_resps)):
        expected_id = 400 + i
        py_id = py_r.get("id")
        ts_id = ts_r.get("id")

        print(f"  [{i}] Python id={py_id}  TS id={ts_id}  expected={expected_id}")

        if py_id != expected_id:
            diffs.append(f"Response[{i}]: Python id={py_id} expected={expected_id}")
        if ts_id != expected_id:
            diffs.append(f"Response[{i}]: TS id={ts_id} expected={expected_id}")

        # Content structure must match
        py_res = py_r.get("result", {})
        ts_res = ts_r.get("result", {})
        py_err = py_res.get("isError", False)
        ts_err = ts_res.get("isError", False)
        if py_err != ts_err:
            diffs.append(f"Response[{i}]: isError Python={py_err} TS={ts_err}")

    # TS uses execFileSync (synchronous) — verify framing is not corrupted.
    # Each response must be valid JSON (already parsed above means framing is fine).
    print(f"  JSON framing preserved: both returned valid parseable JSON-RPC objects")

    record("Test 6: concurrency / ordering / framing", diffs)

# ── Tools/list deep-inspection: field-by-field report ────────────────────────

def report_tools_list_fields(py_tools: dict, ts_tools: dict):
    """Print a per-field compliance table for every schema field in both tools."""
    print(bold("\n╔══════════════════════════════════════════════════════════════╗"))
    print(bold("║  TOOLS/LIST FIELD-BY-FIELD COMPLIANCE TABLE                  ║"))
    print(bold("╚══════════════════════════════════════════════════════════════╝"))

    for tool_name in ["memory", "memory_extensions"]:
        py_t = py_tools.get(tool_name, {})
        ts_t = ts_tools.get(tool_name, {})
        py_schema = py_t.get("inputSchema", {})
        ts_schema = ts_t.get("inputSchema", {})
        py_props = py_schema.get("properties", {})
        ts_props = ts_schema.get("properties", {})

        print(f"\n  Tool: {bold(tool_name)}")
        print(f"  {'Field':<40}  {'Python':<10}  {'TS':<10}  {'Match'}")
        print(f"  {'-'*40}  {'-'*10}  {'-'*10}  {'-'*5}")

        # name, description
        for attr in ["name", "description"]:
            pv = py_t.get(attr, "MISSING")
            tv = ts_t.get(attr, "MISSING")
            match = ok("YES") if pv == tv else fail("NO")
            pv_short = str(pv)[:40] if pv else "MISSING"
            tv_short = str(tv)[:40] if tv else "MISSING"
            print(f"  {attr:<40}  {pv_short:<40}  {tv_short:<40}  {match}")

        # inputSchema top-level
        for attr in ["type", "required"]:
            pv = py_schema.get(attr, "MISSING")
            tv = ts_schema.get(attr, "MISSING")
            match = ok("YES") if pv == tv else fail("NO")
            print(f"  schema.{attr:<33}  {str(pv):<40}  {str(tv):<40}  {match}")

        # additionalProperties (Python does NOT set this; TS may add it via Zod)
        py_ap = py_schema.get("additionalProperties", "NOT-SET")
        ts_ap = ts_schema.get("additionalProperties", "NOT-SET")
        match = ok("YES") if py_ap == ts_ap else fail("NO")
        print(f"  {'schema.additionalProperties':<40}  {str(py_ap):<40}  {str(ts_ap):<40}  {match}")

        # Per-property fields
        all_props = sorted(set(list(py_props.keys()) + list(ts_props.keys())))
        for prop in all_props:
            pp = py_props.get(prop, {})
            tp = ts_props.get(prop, {})
            for attr in ["type", "description", "enum", "items", "minItems", "maxItems"]:
                pv = pp.get(attr, "NOT-SET")
                tv = tp.get(attr, "NOT-SET")
                if pv != "NOT-SET" or tv != "NOT-SET":
                    match = ok("YES") if pv == tv else fail("NO")
                    field_key = f"  props.{prop}.{attr}"
                    print(f"  {field_key:<40}  {str(pv):<40}  {str(tv):<40}  {match}")

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(bold("\n" + "═"*72))
    print(bold("  PARITY FALSIFICATION TEST — memory-mcp-server Python vs TS port"))
    print(bold("═"*72))

    # Temporary MEMORY_ROOT for test isolation
    tmp_root = tempfile.mkdtemp(prefix="parity-test-")
    print(f"\n  MEMORY_ROOT={tmp_root}")

    env_overrides = {
        "MEMORY_ROOT": tmp_root,
        "MEMORY_BACKEND_CMD": BACKEND_SH,
        "MEMORY_AGENT_ID": "parity-test",
        "MEMORY_NO_AUDIT": "1",
        "MEMORY_NO_SYNC": "1",
    }

    print(f"  BACKEND_SH={BACKEND_SH}")
    print(f"  PYTHON_CMD={' '.join(PYTHON_CMD)}")
    print(f"  TS_CMD={' '.join(TS_CMD)}")

    try:
        py = Server("python", PYTHON_CMD, env=env_overrides)
        ts = Server("ts",     TS_CMD,     env=env_overrides)

        # Handshake — required before tools/list and tools/call per MCP spec
        init_req = {
            "jsonrpc": "2.0", "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "parity-preflight", "version": "1"},
            },
        }
        py.send(init_req)
        ts.send(init_req)

        test1_initialize(py, ts)
        py_tools, ts_tools = test2_tools_list(py, ts)
        report_tools_list_fields(py_tools, ts_tools)
        test3_tools_call(py, ts, tmp_root)
        test4_validation_error(py, ts)

        py.stop()
        ts.stop()

    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)

    # Test 5 requires fresh servers with altered env — runs after cleanup
    test5_env_unset()

    # Test 6 requires fresh servers with normal env
    env_overrides2 = {
        "MEMORY_BACKEND_CMD": BACKEND_SH,
        "MEMORY_AGENT_ID": "parity-test",
        "MEMORY_NO_AUDIT": "1",
        "MEMORY_NO_SYNC": "1",
    }
    tmp2 = tempfile.mkdtemp(prefix="parity-conc-")
    env_overrides2["MEMORY_ROOT"] = tmp2
    try:
        py6 = Server("python-conc", PYTHON_CMD, env=env_overrides2)
        ts6 = Server("ts-conc",     TS_CMD,     env=env_overrides2)
        init_req2 = {
            "jsonrpc":"2.0","id":0,"method":"initialize",
            "params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}},
        }
        py6.send(init_req2)
        ts6.send(init_req2)
        test6_concurrency(py6, ts6)
        py6.stop()
        ts6.stop()
    finally:
        shutil.rmtree(tmp2, ignore_errors=True)

    # ── Final verdict ─────────────────────────────────────────────────────────
    print(bold("\n" + "═"*72))
    print(bold("  FINAL VERDICT"))
    print(bold("═"*72))

    any_fail = False
    for name, status, diffs in results:
        if status == "PASS":
            print(f"  {ok('PASS')}  {name}")
        else:
            any_fail = True
            print(f"  {fail('FAIL')}  {name}")
            for d in diffs:
                print(f"         {RED}{d}{RESET}")

    print()
    if any_fail:
        print(fail("  OVERALL: FAIL — TS port is NOT byte-equivalent to Python source"))
        sys.exit(1)
    else:
        print(ok("  OVERALL: PASS — TS port matches Python source for real usage"))
        sys.exit(0)


if __name__ == "__main__":
    main()
