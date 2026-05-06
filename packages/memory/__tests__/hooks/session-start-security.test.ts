/**
 * session-start-security.test.ts — SEC-003 regression test.
 *
 * SEC-003: Python code injection in session-start.ts::autoWirePipeline().
 *
 * Before fix:
 *   sys.path.insert(0, r"${pluginRoot.replace(/\\/g, "/")}")
 *
 * The `r"..."` raw-string literal does not interpret backslashes, but a
 * value containing a `"` closes the literal and the rest of the string
 * is parsed as Python source. CLAUDE_PLUGIN_ROOT is an env var; on a
 * low-trust host (e.g., shared CI runner, malicious shell, MCP plugin
 * installer that sets env), an attacker can inject arbitrary Python.
 *
 * Payload:
 *   CLAUDE_PLUGIN_ROOT='"+__import__("os").system("touch /tmp/PWNED")+"'
 * Under the old code this becomes:
 *   sys.path.insert(0, r""+__import__("os").system("touch /tmp/PWNED")+"")
 * which Python evaluates — touching /tmp/PWNED.
 *
 * Fix: pluginRoot is passed as sys.argv[1], not interpolated. argv values
 *      are byte strings to Python; never evaluated as source.
 *
 * This test simulates the attack by setting CLAUDE_PLUGIN_ROOT to an
 * injection payload, calling autoWirePipeline, and asserting the marker
 * file was NOT created.
 */

import { describe, it, expect } from "vitest";
import { existsSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { autoWirePipeline } from "../../src/hooks/session-start.js";

describe("session-start: SEC-003 Python-code-injection regression", () => {
  it("malicious CLAUDE_PLUGIN_ROOT does NOT execute injected Python", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "sec003-"));
    const markerPath = join(tempRoot, "PWNED_PYTHON");

    // Canonical CWE-95 payload: closes the r"..." raw-string literal, then
    // injects a Python expression that executes os.system("touch <marker>").
    // Under the fixed code (argv-style), this entire string is sys.argv[1]
    // — Python sees it as a single byte string, never code.
    const maliciousRoot = `"+__import__("os").system("touch ${markerPath}")+"`;

    const origRoot = process.env["CLAUDE_PLUGIN_ROOT"];
    process.env["CLAUDE_PLUGIN_ROOT"] = maliciousRoot;
    try {
      // autoWirePipeline either:
      //   - silently returns when python3 is missing or the pipeline module
      //     can't be imported (expected in test env), OR
      //   - runs the static script (post-fix), which fails because the
      //     argv path is bogus — but never executes injected code.
      // Either way, the marker file must NOT exist.
      autoWirePipeline();

      // Allow up to 200ms for any subprocess side-effect to materialise.
      await new Promise((r) => setTimeout(r, 200));

      expect(existsSync(markerPath)).toBe(false);
    } finally {
      if (origRoot === undefined) delete process.env["CLAUDE_PLUGIN_ROOT"];
      else process.env["CLAUDE_PLUGIN_ROOT"] = origRoot;
      try { unlinkSync(markerPath); } catch { /* ignore */ }
      try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("benign CLAUDE_PLUGIN_ROOT also does not crash autoWirePipeline", () => {
    const origRoot = process.env["CLAUDE_PLUGIN_ROOT"];
    process.env["CLAUDE_PLUGIN_ROOT"] = "/tmp/nonexistent-plugin-root";
    try {
      // Must not throw — best-effort no-op when pipeline module is absent.
      expect(() => autoWirePipeline()).not.toThrow();
    } finally {
      if (origRoot === undefined) delete process.env["CLAUDE_PLUGIN_ROOT"];
      else process.env["CLAUDE_PLUGIN_ROOT"] = origRoot;
    }
  });
});
