/**
 * @agentic/codebase — adapters/rust-binary-resolver.ts
 *
 * Resolves the path to the ai-architect-mcp binary at runtime.
 *
 * Resolution order (first match wins):
 *   1. AI_ARCH_BIN environment variable (CI / manual override)
 *   2. @agentic/codebase-rust workspace package via require.resolve()
 *      (available when PR #18 has merged and pnpm install ran)
 *   3. null  — binary not found; caller must handle gracefully (stub mode)
 *
 * source: docs/PHASE_3_PLAN.md §2.3 — scripts.binary-path helper
 * source: docs/PHASE_3_PLAN.md §5.4#2 — "fall back to stub runner" when binary absent
 *
 * Layer: infrastructure / adapters
 * Allowed imports: node:path, node:fs, node:url, stdlib
 */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

/**
 * Attempt to resolve the binary path via @agentic/codebase-rust/package.json.
 * Returns null if the workspace package is not installed.
 *
 * source: docs/PHASE_3_PLAN.md §2.5 — "require.resolve('...package.json')"
 */
function resolveViaWorkspace(): string | null {
  try {
    const pkgJsonPath = _require.resolve(
      "@agentic/codebase-rust/package.json",
    );
    const pkgDir = dirname(pkgJsonPath);
    const candidate = join(pkgDir, "target", "release", "ai-architect-mcp");
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Resolve the absolute path to the ai-architect-mcp binary.
 *
 * precondition: none (may be called before any subprocess is spawned)
 * postcondition:
 *   - returns an absolute path string when the binary exists on disk
 *   - returns null when the binary cannot be found (stub / pre-PR#18 mode)
 */
export function resolveBinaryPath(): string | null {
  // Priority 1: explicit env-var override (CI + local dev).
  const envBin = process.env["AI_ARCH_BIN"];
  if (envBin !== undefined && envBin.length > 0) {
    if (!existsSync(envBin)) {
      process.stderr.write(
        `[codebase:resolver] AI_ARCH_BIN set to "${envBin}" but file does not exist\n`,
      );
      return null;
    }
    return envBin;
  }

  // Priority 2: workspace package.
  const workspacePath = resolveViaWorkspace();
  if (workspacePath !== null) {
    if (existsSync(workspacePath)) {
      return workspacePath;
    }
    process.stderr.write(
      `[codebase:resolver] @agentic/codebase-rust resolved but binary not built at: ${workspacePath}\n` +
        `  Run: pnpm -F @agentic/codebase-rust build\n`,
    );
  }

  return null;
}

/**
 * Resolve the binary path and throw if not found.
 *
 * @throws Error with a human-readable diagnostic when the binary is absent.
 */
export function requireBinaryPath(): string {
  const path = resolveBinaryPath();
  if (path === null) {
    throw new Error(
      "ai-architect-mcp binary not found.\n" +
        "Resolution order tried:\n" +
        "  1. AI_ARCH_BIN environment variable\n" +
        "  2. packages/codebase-rust/target/release/ai-architect-mcp (via @agentic/codebase-rust)\n" +
        "Fix: set AI_ARCH_BIN=<path> or run `pnpm -F @agentic/codebase-rust build`.\n" +
        "Note: @agentic/codebase-rust is available after PR #18 merges.",
    );
  }
  return path;
}
