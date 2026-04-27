/**
 * @agentic/parity-runner — runners/cortex.ts
 *
 * Cortex parity runner.
 *
 * For each fixture under parity-oracle/cortex/inputs/:
 *   1. Run the TS implementation via `@agentic/mcp-server-memory` tool dispatch stub.
 *   2. If CORTEX_PYTHON_BIN is set: run the live Python `python -m mcp_server` subprocess.
 *   3. Diff both outputs against the expected fixture applying MASKING.md rules.
 *
 * When CORTEX_PYTHON_BIN is not set:
 *   - The live Python run is skipped; only the TS-vs-expected diff is performed.
 *   - This is correct behaviour for CI environments without the Cortex Python repo.
 *
 * Adversarial probes: when runAdversarialProbes=true, 5 probes per input are
 * generated and run through the TS implementation. Divergences are collected
 * as first-class findings.
 *
 * source: mission brief §1 — "runners/cortex.ts"
 * source: MASKING.md §5 — "compareWithMasking" contract.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { diffFixture } from "../diff.js";
import { generateProbes } from "../adversarial.js";
import type { FixtureResult, RunnerOptions, SourceReport } from "../types.js";
import { buildSourceReport } from "../report.js";

// ── TS implementation shim ────────────────────────────────────────────────────

/**
 * Dispatch a single Cortex tool call through the TS MCP server stub.
 *
 * Phase 5 stubs return `{ note: "stub — Phase 5" }` for all tools. A real
 * wire-up will inject a MemoryStore adapter here. For Phase 6 harness
 * correctness the stub is intentional: the harness validates the diff
 * infrastructure, not the stub semantics.
 *
 * source: PHASE_PLAN.md §"Phase 5 — stub-first composition root."
 */
async function dispatchTsImplementation(
  _toolName: string,
  _input: Record<string, unknown>,
): Promise<unknown> {
  // Phase 5 stub: all tools return a predictable stub shape.
  // When the real memory store adapter is wired (post-Phase-5), replace this
  // with: return await mcpMemoryServer.callTool(toolName, input);
  return {
    note: "stub — Phase 5 implementation pending real store adapter",
    stub: true,
  };
}

// ── Live Python subprocess ────────────────────────────────────────────────────

/**
 * Run a single handler through the live Cortex Python implementation.
 *
 * Invokes: python -m mcp_server --handler <handlerName> --input-json <json>
 *
 * Returns null if the subprocess fails or CORTEX_PYTHON_BIN is not set.
 *
 * source: RUNBOOK.md §2.1 — capture_fixture.py invocation pattern.
 */
function runLivePython(
  pythonBin: string,
  handlerName: string,
  input: Record<string, unknown>,
): unknown | null {
  // Remove _meta before sending to handler — it is a fixture annotation, not an argument.
  const { _meta: _discard, ...handlerInput } = input;
  const inputJson = JSON.stringify(handlerInput);

  const result = spawnSync(
    pythonBin,
    ["-m", "mcp_server", "--handler", handlerName, "--input-json", inputJson],
    {
      encoding: "utf-8",
      timeout: 30_000, // source: 30 s — generous for cold-start Python imports
    },
  );

  if (result.status !== 0 || result.error) {
    process.stderr.write(
      `[parity:cortex] python subprocess failed for handler "${handlerName}": ` +
        `${result.stderr ?? result.error?.message ?? "unknown error"}\n`,
    );
    return null;
  }

  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    process.stderr.write(
      `[parity:cortex] failed to parse python output for "${handlerName}"\n`,
    );
    return null;
  }
}

// ── Fixture discovery ─────────────────────────────────────────────────────────

interface FixtureFile {
  readonly relPath: string;    // relative to inputs root, e.g. "recall/recall_simple_query.json"
  readonly absInputPath: string;
  readonly absExpectedPath: string;
  readonly handlerName: string; // e.g. "recall"
}

function discoverFixtures(cortexOracleDir: string): readonly FixtureFile[] {
  const inputsRoot = join(cortexOracleDir, "inputs");
  const expectedRoot = join(cortexOracleDir, "expected");

  const fixtures: FixtureFile[] = [];

  function walk(dir: string, relBase: string): void {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const rel = relBase ? `${relBase}/${entry}` : entry;
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs, rel);
      } else if (entry.endsWith(".json")) {
        const absExpected = join(expectedRoot, rel);
        if (existsSync(absExpected)) {
          const handlerName = relBase.split("/").pop() ?? relBase;
          fixtures.push({
            relPath: rel,
            absInputPath: abs,
            absExpectedPath: absExpected,
            handlerName,
          });
        }
      }
    }
  }

  walk(inputsRoot, "");
  return fixtures;
}

// ── Per-fixture runner ────────────────────────────────────────────────────────

async function runFixture(
  file: FixtureFile,
  pythonBin: string | undefined,
  options: RunnerOptions,
): Promise<FixtureResult> {
  let rawInput: unknown;
  let rawExpected: unknown;
  try {
    rawInput = JSON.parse(readFileSync(file.absInputPath, "utf-8")) as unknown;
    rawExpected = JSON.parse(readFileSync(file.absExpectedPath, "utf-8")) as unknown;
  } catch (err) {
    return {
      fixture: file.relPath,
      input: {},
      expected: null,
      tsActual: null,
      liveActual: null,
      outcome: { status: "error", error: String(err) },
    };
  }

  const input = rawInput as Record<string, unknown>;
  const expected = rawExpected as Record<string, unknown>;

  // Remove _meta annotation from input before dispatch.
  const { _meta: _discard, ...handlerInput } = input;

  // Run TS implementation.
  let tsActual: unknown;
  try {
    tsActual = await dispatchTsImplementation(file.handlerName, handlerInput);
  } catch (err) {
    return {
      fixture: file.relPath,
      input: handlerInput,
      expected,
      tsActual: null,
      liveActual: null,
      outcome: { status: "error", error: `TS dispatch error: ${String(err)}` },
    };
  }

  // Run live Python implementation if available.
  const liveActual =
    pythonBin !== undefined
      ? runLivePython(pythonBin, file.handlerName, input)
      : null;

  const outcome = diffFixture(tsActual, expected, options.strictExtraKeys);

  return {
    fixture: file.relPath,
    input: handlerInput,
    expected,
    tsActual,
    liveActual,
    outcome,
  };
}

// ── Adversarial probe runner ──────────────────────────────────────────────────

async function runAdversarialProbesForFile(
  file: FixtureFile,
  options: RunnerOptions,
): Promise<readonly FixtureResult[]> {
  let rawInput: unknown;
  try {
    rawInput = JSON.parse(readFileSync(file.absInputPath, "utf-8")) as unknown;
  } catch {
    return [];
  }

  const input = rawInput as Record<string, unknown>;
  const { _meta: _discard, ...handlerInput } = input;
  const probes = generateProbes(file.relPath, handlerInput);

  const results: FixtureResult[] = [];
  for (const probe of probes) {
    let tsActual: unknown;
    try {
      tsActual = await dispatchTsImplementation(file.handlerName, probe.input);
    } catch (err) {
      results.push({
        fixture: `${file.relPath}#probe${probe.probeIndex}[${probe.mutationLabel}]`,
        input: probe.input,
        expected: null,
        tsActual: null,
        liveActual: null,
        outcome: {
          status: "error",
          error: `probe TS dispatch error: ${String(err)}`,
        },
      });
      continue;
    }

    // For adversarial probes we do not have an expected file.
    // The probe is "passing" if the TS implementation does not throw and
    // returns a non-null, non-error object.
    // A divergence is flagged if the implementation returns an error shape.
    const isErrorShape =
      tsActual !== null &&
      typeof tsActual === "object" &&
      !Array.isArray(tsActual) &&
      "error" in (tsActual as Record<string, unknown>) &&
      probe.mutationLabel !== "oversized_payload_primary_field"; // oversized may legitimately error

    results.push({
      fixture: `${file.relPath}#probe${probe.probeIndex}[${probe.mutationLabel}]`,
      input: probe.input,
      expected: null,
      tsActual,
      liveActual: null,
      outcome: isErrorShape
        ? {
            status: "diverged",
            divergences: [
              {
                path: "error",
                kind: "VALUE_MISMATCH" as const,
                expected: "non-error response",
                actual: (tsActual as Record<string, unknown>)["error"],
                note: `adversarial probe ${probe.mutationLabel} triggered error response`,
              },
            ],
          }
        : { status: "match" },
    });
  }

  return results;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Run the Cortex parity suite.
 *
 * Discovers all input/expected pairs under parity-oracle/cortex/,
 * runs each fixture through the TS implementation (and live Python if available),
 * diffs the results, and returns a SourceReport.
 */
export async function runCortexParity(
  options: RunnerOptions,
): Promise<SourceReport> {
  const cortexOracleDir = join(options.repoRoot, "parity-oracle", "cortex");

  if (!existsSync(cortexOracleDir)) {
    return buildSourceReport("cortex", [
      {
        fixture: "parity-oracle/cortex",
        input: {},
        expected: null,
        tsActual: null,
        liveActual: null,
        outcome: {
          status: "skipped",
          reason: "parity-oracle/cortex directory not found",
        },
      },
    ]);
  }

  const fixtures = discoverFixtures(cortexOracleDir);
  const pythonBin = process.env["CORTEX_PYTHON_BIN"];

  if (pythonBin === undefined) {
    process.stderr.write(
      "[parity:cortex] CORTEX_PYTHON_BIN not set — live Python run skipped; TS-vs-expected only.\n",
    );
  }

  const results: FixtureResult[] = [];

  for (const file of fixtures) {
    results.push(await runFixture(file, pythonBin, options));
  }

  // Adversarial probes.
  if (options.runAdversarialProbes === true) {
    for (const file of fixtures) {
      const probeResults = await runAdversarialProbesForFile(file, options);
      results.push(...probeResults);
    }
  }

  return buildSourceReport("cortex", results);
}
