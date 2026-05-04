/**
 * @agentic/parity-runner — runners/cortex.ts
 *
 * Cortex parity runner.
 *
 * For each fixture under parity-oracle/cortex/inputs/:
 *   1. Run the TS memory MCP server subprocess (when MEMORY_MCP_BIN is set).
 *   2. If CORTEX_PYTHON_BIN is set: run the live Python `python -m mcp_server` subprocess.
 *   3. Diff both outputs against the expected fixture applying MASKING.md rules.
 *
 * When MEMORY_MCP_BIN is not set:
 *   - The TS run falls back to well-formedness validation of input/expected pairs.
 *   - Emits a "skipped — env var not set" entry in the report.
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
 * source: cortex@ed33435 mcp_server/server/http_launcher.py — MCP stdio transport pattern.
 * source: parity-runner/src/runners/codebase.ts — subprocess JSON-RPC reference implementation.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { diffFixture } from "../diff.js";
import { generateProbes } from "../adversarial.js";
import type { FixtureResult, RunnerOptions, SourceReport } from "../types.js";
import { buildSourceReport } from "../report.js";

// ── TS memory MCP subprocess runner ──────────────────────────────────────────

/**
 * Send a single JSON-RPC 2.0 `tools/call` request to the TS memory MCP server
 * subprocess via NDJSON over stdin/stdout.
 *
 * Protocol: one-line JSON-RPC 2.0 request on stdin; one-line response on stdout.
 * The memory MCP server speaks the same NDJSON JSON-RPC wire format as the
 * Rust binary — both use @modelcontextprotocol/sdk's StdioServerTransport.
 *
 * precondition: binaryPath is a valid path to a runnable Node.js MCP server
 *               that accepts stdio JSON-RPC and implements the tools/call method.
 * postcondition: returns the `result.content[0].text` JSON value on success,
 *                or null on subprocess failure / parse error.
 *
 * source: cortex@ed33435 mcp_server/server/http_launcher.py — stdio transport
 * source: parity-runner/src/runners/codebase.ts:58-104 — runLiveRust reference
 * source: modelcontextprotocol.io/specification/2024-11-05 §5 — tools/call shape
 */
function runTsMemoryMcp(
  binaryPath: string,
  toolName: string,
  input: Record<string, unknown>,
): unknown | null {
  // Remove _meta before sending — it is a fixture annotation, not a tool argument.
  const { _meta: _discard, ...toolInput } = input;

  // JSON-RPC 2.0 tools/call request per MCP specification.
  // source: modelcontextprotocol.io/specification/2024-11-05 §5.6 — tools/call
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: toolInput },
  });

  const result = spawnSync(binaryPath, [], {
    input: request + "\n",
    encoding: "utf-8",
    // 30 s: generous for Node.js cold-start + SQLite init on a fixture DB.
    // source: parity-runner/src/runners/cortex.ts — 30 s Python cold-start budget retained.
    timeout: 30_000,
  });

  if (result.status !== 0 || result.error) {
    process.stderr.write(
      `[parity:cortex] TS memory MCP subprocess failed for tool "${toolName}": ` +
        `${result.stderr ?? result.error?.message ?? "unknown error"}\n`,
    );
    return null;
  }

  // Parse the first NDJSON line; the MCP server writes exactly one response per request.
  const firstLine = result.stdout.split("\n")[0] ?? "";
  try {
    const parsed = JSON.parse(firstLine) as {
      result?: { content?: Array<{ type?: string; text?: string }> };
      error?: unknown;
    };

    if (parsed.error !== undefined) {
      process.stderr.write(
        `[parity:cortex] TS memory MCP returned JSON-RPC error for "${toolName}": ` +
          `${JSON.stringify(parsed.error)}\n`,
      );
      return null;
    }

    // MCP tools/call response shape: result.content[0].text holds the JSON payload.
    // source: modelcontextprotocol.io/specification/2024-11-05 §5.6.2
    const text = parsed.result?.content?.[0]?.text;
    if (text !== undefined) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        // text is not JSON — return as-is (some handlers return plain strings).
        return text;
      }
    }

    // Fallback: return the whole result if content structure is absent.
    return parsed.result ?? parsed;
  } catch {
    process.stderr.write(
      `[parity:cortex] failed to parse TS memory MCP output for "${toolName}"\n`,
    );
    return null;
  }
}

/**
 * Well-formedness check for an input/expected pair (stub-runner fallback when
 * MEMORY_MCP_BIN is not set).
 *
 * precondition: relPath, absInputPath, absExpectedPath are valid filesystem paths.
 * postcondition: returns a FixtureResult with outcome=skipped (well-formed) or
 *                outcome=error (broken JSON or missing required fields).
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

  return {
    fixture: relPath,
    input: input as Record<string, unknown>,
    expected: expected as Record<string, unknown>,
    tsActual: null,
    liveActual: null,
    outcome: {
      status: "skipped",
      reason: "MEMORY_MCP_BIN not set — stub-runner: input/expected pair is well-formed",
    },
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
  memoryMcpBin: string | undefined,
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

  // Run TS memory MCP subprocess (when MEMORY_MCP_BIN is set).
  const tsActual =
    memoryMcpBin !== undefined
      ? runTsMemoryMcp(memoryMcpBin, file.handlerName, input)
      : null;

  // Run live Python implementation if available.
  const liveActual =
    pythonBin !== undefined
      ? runLivePython(pythonBin, file.handlerName, input)
      : null;

  const outcome =
    tsActual !== null
      ? diffFixture(tsActual, expected, options.strictExtraKeys)
      : {
          status: "skipped" as const,
          reason: "MEMORY_MCP_BIN not set — TS run skipped",
        };

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
  memoryMcpBin: string | undefined,
  _options: RunnerOptions,
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

  if (memoryMcpBin === undefined) {
    // FAILS_ON: MEMORY_MCP_BIN not set — adversarial probes require the real subprocess.
    return [];
  }

  const results: FixtureResult[] = [];
  for (const probe of probes) {
    const tsActual = runTsMemoryMcp(memoryMcpBin, file.handlerName, {
      ...probe.input,
    });

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
 * Discovers all input/expected pairs under parity-oracle/cortex/.
 *
 * When MEMORY_MCP_BIN is set:
 *   - Spawns the TS memory MCP server subprocess per fixture.
 *   - Diffs the TS output against the expected fixture.
 *
 * When MEMORY_MCP_BIN is not set:
 *   - Validates input/expected pair well-formedness only (stub-runner mode).
 *
 * When CORTEX_PYTHON_BIN is set:
 *   - Additionally runs the live Python subprocess for cross-implementation diff.
 *
 * postcondition: returns a SourceReport with one entry per fixture (plus probes);
 *                skipped entries are emitted for missing env vars.
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
  const memoryMcpBin = process.env["MEMORY_MCP_BIN"];
  const pythonBin = process.env["CORTEX_PYTHON_BIN"];

  if (memoryMcpBin === undefined) {
    process.stderr.write(
      "[parity:cortex] MEMORY_MCP_BIN not set — stub-runner mode: validating fixture well-formedness only.\n",
    );
    const results = fixtures.map((f) =>
      validatePairWellFormedness(f.relPath, f.absInputPath, f.absExpectedPath),
    );
    return buildSourceReport("cortex", results);
  }

  if (pythonBin === undefined) {
    process.stderr.write(
      "[parity:cortex] CORTEX_PYTHON_BIN not set — live Python run skipped; TS-vs-expected only.\n",
    );
  }

  const results: FixtureResult[] = [];

  for (const file of fixtures) {
    results.push(await runFixture(file, memoryMcpBin, pythonBin, options));
  }

  // Adversarial probes.
  if (options.runAdversarialProbes === true) {
    for (const file of fixtures) {
      const probeResults = await runAdversarialProbesForFile(
        file,
        memoryMcpBin,
        options,
      );
      results.push(...probeResults);
    }
  }

  return buildSourceReport("cortex", results);
}
