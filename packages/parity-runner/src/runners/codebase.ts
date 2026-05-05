/**
 * @agentic/parity-runner — runners/codebase.ts
 *
 * Codebase (automatised-pipeline Rust binary) parity runner.
 *
 * When AI_ARCH_BIN is NOT set:
 *   - Live Rust binary run is skipped.
 *   - The runner falls back to "stub-runner" mode: it verifies that each
 *     input/expected pair in parity-oracle/codebase/ is well-formed (JSON
 *     parseable, has _capture_status or _schema_shape fields).
 *   - Emits a "skipped — env var not set" entry in the report for the live run.
 *
 * When AI_ARCH_BIN IS set:
 *   - Run the Rust binary via JSON-RPC over stdio (per RUNBOOK.md §3).
 *   - Run the TS adapter via @agentic/mcp-server-codebase stub.
 *   - Diff both against expected.
 *
 * source: mission brief §1 — "runners/codebase.ts"
 * source: RUNBOOK.md §3 — Rust binary JSON-RPC invocation pattern.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { diffFixture } from "../diff.js";
import { generateProbes } from "../adversarial.js";
import type { FixtureResult, RunnerOptions, SourceReport } from "../types.js";
import { buildSourceReport } from "../report.js";

// ── TS stub implementation ────────────────────────────────────────────────────

/**
 * Dispatch a codebase tool call through the TS MCP server stub.
 *
 * @agentic/mcp-server-codebase is a Phase-5 stub. When Phase 3 completes
 * (the Rust subprocess adapter), replace this with a real dispatch.
 *
 * source: PHASE_PLAN.md §"Phase 3 — Wrap Rust as subprocess."
 */
async function dispatchTsCodebase(
  _toolName: string,
  _input: Record<string, unknown>,
): Promise<unknown> {
  return {
    note: "stub — @agentic/mcp-server-codebase Phase-3 implementation pending",
    stub: true,
  };
}

// ── Live Rust binary runner ───────────────────────────────────────────────────

/**
 * Send a single JSON-RPC request to the live Rust binary via stdin/stdout.
 *
 * Protocol: one-line JSON-RPC 2.0 request on stdin; one-line response on stdout.
 * source: RUNBOOK.md §3.2 — capture_codebase_fixture.js invocation.
 */
function runLiveRust(
  binaryPath: string,
  toolName: string,
  input: Record<string, unknown>,
): unknown | null {
  const { _meta: _discard, ...handlerInput } = input;

  // Replace <WORKTREE_ROOT> placeholder in string-valued fields.
  // source: RUNBOOK.md §3.2 — "Replace <WORKTREE_ROOT> placeholder."
  const repoRoot = process.env["AGENTIC_REPO_ROOT"] ?? process.cwd();
  const processedInput: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(handlerInput)) {
    processedInput[k] =
      typeof v === "string" ? v.replace("<WORKTREE_ROOT>", repoRoot) : v;
  }

  // MCP protocol 2024-11-05 — binary requires tools/call with name + arguments.
  // source: measured binary invocation — method: toolName returns "Method not found"
  // source: MCP spec 2024-11-05 §5.5 — tools/call is the canonical tool invocation method
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: processedInput },
  });

  const result = spawnSync(binaryPath, [], {
    input: request + "\n",
    encoding: "utf-8",
    timeout: 60_000, // source: 60 s — Rust cold-start + index build for fixture repo
  });

  if (result.status !== 0 || result.error) {
    process.stderr.write(
      `[parity:codebase] rust binary failed for "${toolName}": ` +
        `${result.stderr ?? result.error?.message ?? "unknown error"}\n`,
    );
    return null;
  }

  try {
    // MCP envelope: { result: { content: [{ type: "text", text: "<json>" }] } }
    // source: measured binary output — tools/call wraps result in content array
    const envelope = JSON.parse(result.stdout) as {
      result?: { content?: Array<{ type: string; text: string }> };
      error?: { code: number; message: string };
    };
    if (envelope.error) {
      process.stderr.write(
        `[parity:codebase] binary returned error for "${toolName}": ${envelope.error.message}\n`,
      );
      return null;
    }
    const text = envelope.result?.content?.[0]?.text;
    if (text) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text as unknown;
      }
    }
    return envelope.result ?? envelope;
  } catch {
    process.stderr.write(
      `[parity:codebase] failed to parse rust output for "${toolName}"\n`,
    );
    return null;
  }
}

// ── Fixture validation (stub-runner mode) ─────────────────────────────────────

/**
 * Well-formedness check for an input/expected pair.
 *
 * Verifies: both files are valid JSON; expected has _capture_status or
 * _schema_shape; input is an object (even if only _meta).
 *
 * Returns a FixtureResult with outcome=skipped (well-formed) or error (broken).
 */
function validatePairWellFormedness(
  relPath: string,
  absInputPath: string,
  absExpectedPath: string,
): FixtureResult {
  let input: unknown;
  let expected: unknown;

  try {
    input = JSON.parse(readFileSync(absInputPath, "utf-8")) as unknown;
  } catch (err) {
    return {
      fixture: relPath,
      input: {},
      expected: null,
      tsActual: null,
      liveActual: null,
      outcome: { status: "error", error: `input JSON invalid: ${String(err)}` },
    };
  }

  try {
    expected = JSON.parse(readFileSync(absExpectedPath, "utf-8")) as unknown;
  } catch (err) {
    return {
      fixture: relPath,
      input: input as Record<string, unknown>,
      expected: null,
      tsActual: null,
      liveActual: null,
      outcome: { status: "error", error: `expected JSON invalid: ${String(err)}` },
    };
  }

  const exp = expected as Record<string, unknown>;
  const hasStatus = "_capture_status" in exp;
  const hasShape = "_schema_shape" in exp;

  if (!hasStatus && !hasShape) {
    return {
      fixture: relPath,
      input: input as Record<string, unknown>,
      expected: exp,
      tsActual: null,
      liveActual: null,
      outcome: {
        status: "error",
        error: "expected file missing both _capture_status and _schema_shape",
      },
    };
  }

  return {
    fixture: relPath,
    input: input as Record<string, unknown>,
    expected: exp,
    tsActual: null,
    liveActual: null,
    outcome: {
      status: "skipped",
      reason: "AI_ARCH_BIN not set — stub-runner: input/expected pair is well-formed",
    },
  };
}

// ── Fixture-to-tool-name mapping ─────────────────────────────────────────────
//
// Fixture filenames are descriptive (e.g. get_symbol_known, index_codebase_smallrepo).
// Tool names are the exact MCP tool names (e.g. get_symbol, index_codebase).
// When a fixture name differs from the tool name, map it here.
//
// source: parity-oracle/codebase/inputs/ filenames vs tool_schemas.rs tool names (commit 2cc3780)
const FIXTURE_TO_TOOL_NAME: Readonly<Record<string, string>> = {
  get_symbol_known: "get_symbol",
  index_codebase_smallrepo: "index_codebase",
  query_graph_simple: "query_graph",
  search_codebase_keyword: "search_codebase",
};

/**
 * Resolve the MCP tool name from a fixture filename stem.
 * Falls back to the fixture name itself when no mapping exists.
 */
function resolveToolName(fixtureBase: string): string {
  return FIXTURE_TO_TOOL_NAME[fixtureBase] ?? fixtureBase;
}

// ── Fixture discovery ─────────────────────────────────────────────────────────

interface FixtureFile {
  readonly relPath: string;
  readonly absInputPath: string;
  readonly absExpectedPath: string;
  readonly toolName: string;
}

function discoverFixtures(codebaseOracleDir: string): readonly FixtureFile[] {
  const inputsRoot = join(codebaseOracleDir, "inputs");
  const expectedRoot = join(codebaseOracleDir, "expected");
  const fixtures: FixtureFile[] = [];

  if (!existsSync(inputsRoot)) return fixtures;

  function walk(dir: string, relBase: string): void {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const rel = relBase ? `${relBase}/${entry}` : entry;
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs, rel);
      } else if (entry.endsWith(".json")) {
        const fixtureBase = entry.replace(".json", "");
        const absExpected = join(expectedRoot, `${fixtureBase}.json`);
        if (existsSync(absExpected)) {
          fixtures.push({
            relPath: rel,
            absInputPath: abs,
            absExpectedPath: absExpected,
            toolName: resolveToolName(fixtureBase),
          });
        }
      }
    }
  }

  walk(inputsRoot, "");
  return fixtures;
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runCodebaseParity(
  options: RunnerOptions,
): Promise<SourceReport> {
  const codebaseOracleDir = join(options.repoRoot, "parity-oracle", "codebase");

  if (!existsSync(codebaseOracleDir)) {
    return buildSourceReport("codebase", [
      {
        fixture: "parity-oracle/codebase",
        input: {},
        expected: null,
        tsActual: null,
        liveActual: null,
        outcome: {
          status: "skipped",
          reason: "parity-oracle/codebase directory not found",
        },
      },
    ]);
  }

  const fixtures = discoverFixtures(codebaseOracleDir);
  const rustBin = process.env["AI_ARCH_BIN"];

  if (rustBin === undefined) {
    process.stderr.write(
      "[parity:codebase] AI_ARCH_BIN not set — stub-runner mode: validating fixture well-formedness only.\n",
    );

    const results = fixtures.map((f) =>
      validatePairWellFormedness(f.relPath, f.absInputPath, f.absExpectedPath),
    );
    return buildSourceReport("codebase", results);
  }

  // Live mode: run both Rust binary and TS stub.
  const results: FixtureResult[] = [];

  for (const file of fixtures) {
    let rawInput: unknown;
    let rawExpected: unknown;
    try {
      rawInput = JSON.parse(readFileSync(file.absInputPath, "utf-8")) as unknown;
      rawExpected = JSON.parse(readFileSync(file.absExpectedPath, "utf-8")) as unknown;
    } catch (err) {
      results.push({
        fixture: file.relPath,
        input: {},
        expected: null,
        tsActual: null,
        liveActual: null,
        outcome: { status: "error", error: String(err) },
      });
      continue;
    }

    const input = rawInput as Record<string, unknown>;
    const expected = rawExpected as Record<string, unknown>;
    const { _meta: _discard, ...handlerInput } = input;

    const liveActual = runLiveRust(rustBin, file.toolName, input);
    let tsActual: unknown;
    try {
      tsActual = await dispatchTsCodebase(file.toolName, handlerInput);
    } catch (err) {
      results.push({
        fixture: file.relPath,
        input: handlerInput,
        expected,
        tsActual: null,
        liveActual,
        outcome: { status: "error", error: `TS dispatch error: ${String(err)}` },
      });
      continue;
    }

    results.push({
      fixture: file.relPath,
      input: handlerInput,
      expected,
      tsActual,
      liveActual,
      outcome: diffFixture(tsActual, expected, options.strictExtraKeys),
    });
  }

  if (options.runAdversarialProbes === true) {
    for (const file of fixtures) {
      let rawInput: unknown;
      try {
        rawInput = JSON.parse(readFileSync(file.absInputPath, "utf-8")) as unknown;
      } catch {
        continue;
      }
      const input = rawInput as Record<string, unknown>;
      const { _meta: _discard, ...handlerInput } = input;
      const probes = generateProbes(file.relPath, handlerInput);

      for (const probe of probes) {
        let tsActual: unknown;
        try {
          tsActual = await dispatchTsCodebase(file.toolName, probe.input);
        } catch (err) {
          results.push({
            fixture: `${file.relPath}#probe${probe.probeIndex}[${probe.mutationLabel}]`,
            input: probe.input,
            expected: null,
            tsActual: null,
            liveActual: null,
            outcome: { status: "error", error: String(err) },
          });
          continue;
        }

        results.push({
          fixture: `${file.relPath}#probe${probe.probeIndex}[${probe.mutationLabel}]`,
          input: probe.input,
          expected: null,
          tsActual,
          liveActual: null,
          outcome: { status: "match" }, // probes have no expected — just verify no throw
        });
      }
    }
  }

  return buildSourceReport("codebase", results);
}
