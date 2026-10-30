import { z } from 'zod';
import type { GateBase } from '../domain/count.js';
import type { Job } from '../domain/layout.js';
import type { ReadFailure } from '../domain/violation.js';
import { parseJson } from './json.js';

const Glob = z.string().min(1);
const FileSet = z.strictObject({ include: z.array(Glob).min(1), exclude: z.array(Glob) });
const Path = z.string().min(1);

/** Schema of tools/test-gate/gate.json, the descriptive configuration of the gate. */
export const GateConfigSchema = z.strictObject({
  production: FileSet,
  features: FileSet,
  stepDefinitions: z.array(Glob).min(1),
  components: z.array(Glob),
  jobs: z.record(Glob, z.strictObject({ features: z.array(Glob).min(1), mutation: z.boolean() })),
  reports: z.strictObject({
    cucumber: Path,
    mutation: Path,
    base: Path,
    plan: Path,
    report: Path,
    baseOut: Path,
  }),
});

export type GateConfig = z.infer<typeof GateConfigSchema>;

/** Schema of gate-base.json (written by the gate, read back from the artifact of the last green main run). */
export const GateBaseSchema = z.strictObject({
  job: z.string().min(1),
  sha: z.string().min(1),
  count: z.number().int().nonnegative(),
  pickles: z.array(z.string()),
});

export function parseGateConfig(text: string): GateConfig | ReadFailure {
  return parseJson(GateConfigSchema, text);
}

export function parseGateBase(text: string): GateBase | ReadFailure {
  return parseJson(GateBaseSchema, text);
}

/** The named job, or null when gate.json does not declare it. */
export function jobOf(config: GateConfig, name: string): Job | null {
  const job = config.jobs[name];
  return job === undefined ? null : { name, ...job };
}
