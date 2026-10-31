import { debtEntries, renderGenerated, type DebtInput, type DebtRegistry } from '../domain/debt.js';
import type { ReadFailure } from '../domain/violation.js';
import { z } from 'zod';
import type { GateConfig } from './config.js';
import type { GitRepository } from './git.js';
import { jsonText, parseJson } from './json.js';
import { parseMutationReport } from './mutation-report.js';
import type { Workspace } from './workspace.js';

const Position = z.strictObject({
  line: z.number().int().positive(),
  column: z.number().int().nonnegative(),
});

/** Schema of the mutation debt registry (gate.json `debt`). */
export const DebtRegistrySchema = z.strictObject({
  survivors: z.array(
    z.strictObject({
      file: z.string().min(1),
      start: Position,
      end: Position,
      mutator: z.string().min(1),
      original: z.string(),
      replacement: z.string(),
    }),
  ),
});

export function parseDebtRegistry(text: string): DebtRegistry | ReadFailure {
  return parseJson(DebtRegistrySchema, text);
}

/** The registry of the working tree and of the first parent, and which of their files exist in the tree. */
export function readDebt(
  path: string,
  workspace: Workspace,
  repository: GitRepository,
  firstParent: string | null,
): DebtInput {
  const text = workspace.read(path);
  const current = text === null ? { failure: `${path} absent` } : parseDebtRegistry(text);
  const parent =
    firstParent === null || !repository.filesAt(firstParent).includes(path)
      ? null
      : parseDebtRegistry(repository.show(firstParent, path));
  const entries = [current, parent].flatMap((registry) =>
    registry === null || 'failure' in registry ? [] : registry.survivors,
  );
  const present = new Set(entries.map((entry) => entry.file).filter((file) => workspace.exists(file)));
  return { path, current, parent, present };
}

/**
 * `test-gate debt`: writes the registry from the mutation report. The summary to print, or the reason the gate
 * refuses: the registry can only shrink, so it is never regenerated.
 */
export function generateDebt(config: GateConfig, workspace: Workspace): { summary: string } | ReadFailure {
  if (workspace.exists(config.debt)) {
    return {
      failure: `le registre ne peut que rétrécir : on ne le régénère pas (${config.debt} existe déjà)`,
    };
  }
  const text = workspace.read(config.reports.mutation);
  const report = text === null ? { failure: `${config.reports.mutation} absent` } : parseMutationReport(text);
  if ('failure' in report) return { failure: `rapport de mutation illisible : ${report.failure}` };
  const survivors = debtEntries(report);
  workspace.write(config.debt, jsonText({ survivors }));
  return { summary: renderGenerated(config.debt, survivors) };
}
