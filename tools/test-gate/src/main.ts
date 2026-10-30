// Composition root and CLI of the CI gate (doc §7): `node --import tsx tools/test-gate/src/main.ts plan|check
// [--job <name>]`, run from the repository root. Everything else lives in runGate, exercised in-process by the
// scenarios of tools/test-gate/features; this file holds no branch, literal or call Stryker could mutate.
import { runGate } from './infrastructure/gate.js';

process.exitCode = runGate(process.argv, process.cwd(), process.env, process.stdout);
