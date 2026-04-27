/**
 * @agentic/parity-runner — runners/prd.ts
 *
 * PRD-pipeline parity runner.
 *
 * When PRD_GEN_BIN is NOT set:
 *   - Live prd-spec-generator run is skipped.
 *   - Falls back to stub-runner: verifies input/expected pairs are well-formed.
 *   - Emits "skipped — env var not set" in the report.
 *
 * When PRD_GEN_BIN IS set:
 *   - Run the live prd-spec-generator TS binary via Node.js subprocess.
 *   - Run the monorepo @agentic/mcp-server-prd stub.
 *   - Diff both against expected.
 *
 * source: mission brief §1 — "runners/prd.ts"
 * source: RUNBOOK.md §4 — prd-pipeline capture pattern.
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
 * Dispatch a PRD tool call through the TS MCP server stub.
 *
 * @agentic/mcp-server-prd is a Phase-5 stub. When Phase 2 completes
 * (prd-spec-generator migration into the monorepo), replace this.
 *
 * source: PHASE_PLAN.md §"Phase 2 — Move TS repos preserving git history."
 */
async function dispatchTsPrd(
  _toolName: string,
  _input: Record<string, unknown>,
): Promise<unknown> {
  return {
    note: "stub — @agentic/mcp-server-prd Phase-2 implementation pending",
    stub: true,
  };
}

// ── Live prd-spec-generator subprocess ───────────────────────────────────────

/**
 * Run a single prd-spec-generator tool call via Node.js subprocess.
 *
 * Expects the binary to accept `--tool <name> --input-json <json>` and emit
 * JSON to stdout. This mirrors the capture pattern in RUNBOOK.md §4.
 *
 * source: RUNBOOK.md §4.3 — start_pipeline via orchestration package.
 */
function runLivePrd(
  prdBin: string,
  toolName: string,
  input: Record<string, unknown>,
): unknown | null {
  const { _meta: _discard, ...handlerInput } = input;
  const inputJson = JSON.stringify(handlerInput);

  const result = spawnSync(
    process.execPath, // node
    [prdBin, "--tool", toolName, "--input-json", inputJson],
    {
      encoding: "utf-8",
      timeout: 30_000, // source: 30 s — node cold-start + prd orchestration
    },
  );

  if (result.status !== 0 || result.error) {
    process.stderr.write(
      `[parity:prd] subprocess failed for tool "${toolName}": ` +
        `${result.stderr ?? result.error?.message ?? "unknown error"}\n`,
    );
    return null;
  }

  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    process.stderr.write(
      `[parity:prd] failed to parse prd output for "${toolName}"\n`,
    );
    return null;
  }
}

// ── Fixture validation (stub-runner mode) ─────────────────────────────────────

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

  return {
    fixture: relPath,
    input: input as Record<string, unknown>,
    expected: exp,
    tsActual: null,
    liveActual: null,
    outcome: {
      status: "skipped",
      reason: "PRD_GEN_BIN not set — stub-runner: input/expected pair is well-formed",
    },
  };
}

// ── Fixture discovery ─────────────────────────────────────────────────────────

interface FixtureFile {
  readonly relPath: string;
  readonly absInputPath: string;
  readonly absExpectedPath: string;
  readonly toolName: string;
}

function discoverFixtures(prdOracleDir: string): readonly FixtureFile[] {
  const inputsRoot = join(prdOracleDir, "inputs");
  const expectedRoot = join(prdOracleDir, "expected");
  const fixtures: FixtureFile[] = [];

  if (!existsSync(inputsRoot)) return fixtures;

  for (const entry of readdirSync(inputsRoot)) {
    if (!entry.endsWith(".json")) continue;
    const absInput = join(inputsRoot, entry);
    const st = statSync(absInput);
    if (!st.isFile()) continue;

    const fixtureBase = entry.replace(".json", "");
    const absExpected = join(expectedRoot, `${fixtureBase}.json`);
    if (existsSync(absExpected)) {
      fixtures.push({
        relPath: entry,
        absInputPath: absInput,
        absExpectedPath: absExpected,
        toolName: fixtureBase,
      });
    }
  }

  return fixtures;
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runPrdParity(
  options: RunnerOptions,
): Promise<SourceReport> {
  const prdOracleDir = join(options.repoRoot, "parity-oracle", "prd");

  if (!existsSync(prdOracleDir)) {
    return buildSourceReport("prd", [
      {
        fixture: "parity-oracle/prd",
        input: {},
        expected: null,
        tsActual: null,
        liveActual: null,
        outcome: {
          status: "skipped",
          reason: "parity-oracle/prd directory not found",
        },
      },
    ]);
  }

  const fixtures = discoverFixtures(prdOracleDir);
  const prdBin = process.env["PRD_GEN_BIN"];

  if (prdBin === undefined) {
    process.stderr.write(
      "[parity:prd] PRD_GEN_BIN not set — stub-runner mode: validating fixture well-formedness only.\n",
    );

    const results = fixtures.map((f) =>
      validatePairWellFormedness(f.relPath, f.absInputPath, f.absExpectedPath),
    );
    return buildSourceReport("prd", results);
  }

  // Live mode.
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

    const liveActual = runLivePrd(prdBin, file.toolName, input);
    let tsActual: unknown;
    try {
      tsActual = await dispatchTsPrd(file.toolName, handlerInput);
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
          tsActual = await dispatchTsPrd(file.toolName, probe.input);
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
          outcome: { status: "match" },
        });
      }
    }
  }

  return buildSourceReport("prd", results);
}
