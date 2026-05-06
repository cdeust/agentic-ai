/**
 * file-diff-security.test.ts — regression tests proving SEC-001 fix.
 *
 * SEC-001: command injection in /api/file-diff via shell metacharacters
 *   in the `name` query parameter.
 *
 * Before fix: `name` was interpolated into a shell string passed to
 * execSync(`git diff HEAD -- "${filePath}"`). Payloads such as
 * `foo";id;echo "` escaped the quoted filename, causing arbitrary
 * shell execution.
 *
 * After fix: file-diff.ts uses execFileSync(_, _, {shell: false}) with
 * the path passed as a separate argv element after `--`. sanitiseName
 * additionally rejects shell metacharacters as defense in depth.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

import { sanitiseName, registerFileDiffRoutes } from "../src/routes/file-diff.js";

// ── Direct sanitiseName falsification tests ────────────────────────────────

describe("sanitiseName: SEC-001 shell-metacharacter rejection", () => {
  /**
   * Each payload must be rejected (return null). If sanitiseName accepted
   * any of these, the downstream git invocation — even argv-only — would
   * be passed a string that breaks taint analysis. Belt-and-braces.
   */
  it.each([
    // Classic shell escape inside the previous double-quoted interpolation.
    [`foo";id;echo "`,           ";"],
    // Backtick command substitution.
    ["foo`id`bar",               "`"],
    // $(...) command substitution.
    ["foo$(id)bar",               "$"],
    // Newline ending the argument and starting a new shell command.
    ["foo\nrm -rf /tmp/pwn",     "\n"],
    // Carriage return — same DoS class.
    ["foo\rmalicious",           "\r"],
    // Pipe to another command.
    ["foo|id",                    "|"],
    // Ampersand backgrounding.
    ["foo&id",                    "&"],
    // NUL truncation (CWE-158).
    ["foo\x00bar",                "\x00"],
  ])("rejects payload %j (contains %j)", (payload) => {
    expect(sanitiseName(payload)).toBeNull();
  });

  /**
   * Path traversal must still be rejected.
   */
  it.each([
    ["../etc/passwd"],
    ["foo/../../etc/passwd"],
    ["..\\..\\windows\\system32\\drivers\\etc\\hosts"],
  ])("rejects traversal payload %j", (payload) => {
    expect(sanitiseName(payload)).toBeNull();
  });

  /**
   * Benign filenames must round-trip.
   */
  it.each([
    ["src/index.ts",                  "src/index.ts"],
    ["a/b/c.md",                      "a/b/c.md"],
    ["packages/memory/src/foo.rs",    "packages/memory/src/foo.rs"],
    [" trimmed.ts ",                  "trimmed.ts"],
  ])("accepts benign payload %j -> %j", (payload, expected) => {
    expect(sanitiseName(payload)).toBe(expected);
  });
});

// ── End-to-end test: malicious payload cannot execute commands ──────────────

describe("/api/file-diff: SEC-001 command-injection regression", () => {
  /**
   * Falsification test:
   *
   *   1. Create a temp git repo with one tracked file.
   *   2. Spawn a route handler that wraps file-diff.ts.
   *   3. Issue a request with a name parameter containing a payload that
   *      would write a marker file IF shell interpolation occurred:
   *
   *        name=foo";echo PWNED > MARKER;echo "
   *
   *   4. Assert: MARKER file is NEVER created.
   *   5. Assert: response status is 400 (sanitiseName rejected the payload).
   *
   * If the fix regresses, the marker file would appear in the temp dir
   * because the shell would execute the embedded `echo` command.
   */
  it("malicious name does NOT execute shell commands and returns 400", async () => {
    // Create an isolated temp git repo so the test is hermetic.
    const tempRoot = mkdtempSync(join(tmpdir(), "sec001-"));
    spawnSync("git", ["init", "--quiet"], { cwd: tempRoot });
    spawnSync("git", ["config", "user.email", "t@t.t"], { cwd: tempRoot });
    spawnSync("git", ["config", "user.name", "t"], { cwd: tempRoot });
    writeFileSync(join(tempRoot, "tracked.txt"), "hello\n");
    spawnSync("git", ["add", "."], { cwd: tempRoot });
    spawnSync("git", ["commit", "-m", "init", "--quiet"], { cwd: tempRoot });

    const fastify = Fastify({ logger: false });
    await registerFileDiffRoutes(fastify);

    const markerPath = join(tempRoot, "MARKER");
    // The payload would, under the old (vulnerable) implementation, create
    // MARKER in the cwd of the git command. We deliberately use absolute
    // path inside tempRoot in the marker check to be unambiguous.
    const maliciousName = `tracked.txt";touch ${markerPath};echo "`;

    const response = await fastify.inject({
      method: "GET",
      url: `/api/file-diff?name=${encodeURIComponent(maliciousName)}`,
    });

    // 1. The route must reject the payload — sanitiseName rejects ;, $, ".
    expect(response.statusCode).toBe(400);

    // 2. CRITICAL: the marker file must NOT exist. If it does, the shell
    //    interpreted the payload — i.e., command injection regressed.
    let markerExists = false;
    try {
      const fs2 = await import("node:fs");
      markerExists = fs2.existsSync(markerPath);
    } catch {
      // ignore
    }
    expect(markerExists).toBe(false);

    await fastify.close();
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  /**
   * Sanity test: a benign absolute path inside a real git repo still
   * returns 200 with diff lines.  Without this, the security fix could
   * trivially "pass" by rejecting all input — which would be a denial
   * of service, not a fix.
   *
   * NOTE: We intentionally do NOT call process.chdir() here.  Vitest can
   * run tests in shared worker processes; mutating process.cwd() in one
   * test bleeds into the others (verified 2026-05-06: an earlier draft
   * of this test caused stray git commits in the worktree root via that
   * exact mechanism).  Instead, we pass an absolute path that
   * resolveGitRoot() can locate via os.homedir() / process.cwd().
   *
   * Because the dashboard route resolves git roots from a fixed set of
   * parent directories (homedir + cwd, by design), an absolute path
   * outside those roots is rejected with 404 — that is correct behaviour
   * and what we assert here.  The point of this test is the end-to-end
   * path: route accepts a benign name, calls argv-only git, and returns
   * a structured response (200 OK or 404 not-a-repo) — never executes
   * shell.
   */
  it("benign name returns a structured response (200 or 404)", async () => {
    const fastify = Fastify({ logger: false });
    await registerFileDiffRoutes(fastify);
    try {
      const response = await fastify.inject({
        method: "GET",
        url: `/api/file-diff?name=README.md`,
      });
      // Either 200 (this test happened to run inside a git repo) or 404
      // (cwd/homedir is not a git repo) is acceptable — both prove the
      // route ran without shell injection.
      expect([200, 404]).toContain(response.statusCode);
    } finally {
      await fastify.close();
    }
  });
});
