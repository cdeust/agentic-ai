import type { ReadFailure, Violation } from './violation.js';

/** A position of the Stryker report: line and column both start at one, the end column is exclusive. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** One known surviving mutant of the code that predates brick 1a. Its identity is text, never the mutant `id`. */
export interface DebtEntry {
  readonly file: string;
  readonly start: Position;
  readonly end: Position;
  readonly mutator: string;
  /** The code the mutant replaces: the slice of the file between start and end. */
  readonly original: string;
  readonly replacement: string;
}

/** The mutation debt registry (gate.json `debt`): it can only shrink. */
export interface DebtRegistry {
  readonly survivors: readonly DebtEntry[];
}

/** What the debt needs of a mutant of the Stryker report. */
export interface DebtMutant {
  readonly mutatorName: string;
  readonly status: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly replacement: string;
}

/** What the debt needs of the Stryker report (MutationReport satisfies it). */
export interface DebtReport {
  readonly files: ReadonlyMap<string, { readonly source: string; readonly mutants: readonly DebtMutant[] }>;
  readonly mutate: readonly string[];
}

/** The registries and the tree rule 6 reads. */
export interface DebtInput {
  /** Path of the registry, as in gate.json. */
  readonly path: string;
  /** The registry of the working tree; a ReadFailure when it is absent or malformed. */
  readonly current: DebtRegistry | ReadFailure;
  /** The registry of the first parent; null when the first parent has no such file or there is no first parent. */
  readonly parent: DebtRegistry | ReadFailure | null;
  /** The files of the entries of both registries that exist in the working tree. */
  readonly present: ReadonlySet<string>;
}

/** What the report prints of the debt. */
export interface DebtSummary {
  readonly path: string;
  /** Entries of the current registry. */
  readonly survivors: number;
  /** Mutants of the rule 5 perimeter accepted because they are in the registry. */
  readonly accepted: number;
  /** Entries whose mutant is in the report of this run but did not survive it (Killed, Timeout, ...). */
  readonly notSurvived: number;
  /** Entries the current registry holds and the first parent's does not (all of them for a creation). */
  readonly added: number;
  readonly removed: number;
  /** The first parent has no registry: this diff creates it. */
  readonly created: boolean;
}

export interface DebtJudgement {
  readonly summary: DebtSummary;
  readonly violations: readonly Violation[];
}

const DEBT_STATUSES = new Set(['Survived', 'NoCoverage']);
const NOT_KILLED = new Set(['Survived', 'NoCoverage', 'Pending']);

/** The readable identity of an entry: `file:l:c-l:c mutator original -> replacement`. */
export function debtIdentity(entry: DebtEntry): string {
  const { file, start, end } = entry;
  const where = `${file}:${start.line}:${start.column}-${end.line}:${end.column}`;
  return `${where} ${entry.mutator} ${JSON.stringify(entry.original)} -> ${JSON.stringify(entry.replacement)}`;
}

// Every position is inside `source`: parseMutationReport refuses a report whose mutant reaches past the last line.
function sliceOf(source: string, start: Position, end: Position): string {
  const lines = source.split('\n');
  const line = (position: Position) => lines[position.line - 1] as string;
  if (start.line === end.line) return line(start).slice(start.column - 1, end.column - 1);
  return [
    line(start).slice(start.column - 1),
    ...lines.slice(start.line, end.line - 1),
    line(end).slice(0, end.column - 1),
  ].join('\n');
}

/** The entry that stands for a mutant of `file`, `source` being the file as the report carries it. */
export function entryOf(file: string, mutant: DebtMutant, source: string): DebtEntry {
  const start = { line: mutant.startLine, column: mutant.startColumn };
  const end = { line: mutant.endLine, column: mutant.endColumn };
  return {
    file,
    start,
    end,
    mutator: mutant.mutatorName,
    original: sliceOf(source, start, end),
    replacement: mutant.replacement,
  };
}

function earlier(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every Survived and NoCoverage mutant of every file of the report, by file, line, column, mutator, replacement. */
export function debtEntries(report: DebtReport): DebtEntry[] {
  return [...report.files]
    .flatMap(([file, result]) =>
      result.mutants
        .filter((mutant) => DEBT_STATUSES.has(mutant.status))
        .map((mutant) => entryOf(file, mutant, result.source)),
    )
    .sort(
      (a, b) =>
        earlier(a.file, b.file) ||
        a.start.line - b.start.line ||
        a.start.column - b.start.column ||
        earlier(a.mutator, b.mutator) ||
        earlier(a.replacement, b.replacement),
    );
}

/**
 * What `test-gate debt` prints: entries by first directory of their file, then the total. `entries` come sorted by
 * file (debtEntries), so the Map, which keeps insertion order, meets the directories in that order: sorting them
 * again would change nothing.
 */
export function renderGenerated(path: string, entries: readonly DebtEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const directory = entry.file.split('/')[0] as string;
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  const lines = [...counts].map(([directory, n]) => `- ${directory} : ${n}`);
  return [`registre de dette écrit : ${path}`, ...lines, `- total : ${entries.length}`, ''].join('\n');
}

/** The entries of a registry; none when it is unreadable. */
function entriesOf(registry: DebtRegistry | ReadFailure): readonly DebtEntry[] {
  return 'failure' in registry ? [] : registry.survivors;
}

/** The identities of the current registry, for rule 5; empty when it is unreadable. */
export function acceptedIdentities(input: DebtInput): ReadonlySet<string> {
  return new Set(entriesOf(input.current).map(debtIdentity));
}

/** Entries of the first parent's registry that the current one no longer holds; none when either is unreadable. */
function removedEntries(input: DebtInput): DebtEntry[] {
  const { current, parent } = input;
  if (parent === null || 'failure' in parent || 'failure' in current) return [];
  const now = new Set(current.survivors.map(debtIdentity));
  return parent.survivors.filter((entry) => !now.has(debtIdentity(entry)));
}

/**
 * Production files of removed entries: Stryker must mutate them so that the removal is proved (rule 6). A removed
 * entry whose file is gone from the tree is allowed without proof.
 */
export function retiredFiles(input: DebtInput, production: readonly string[]): string[] {
  const files = new Set(removedEntries(input).map((entry) => entry.file));
  return production.filter((file) => files.has(file) && input.present.has(file));
}

/** Rule 6: the registry is readable, only shrinks, and tells the truth about the files and the report. */
export function judgeDebt(
  input: DebtInput,
  report: DebtReport | ReadFailure,
  accepted: number,
): DebtJudgement {
  const violations: Violation[] = [];
  const add = (text: string) => violations.push({ rule: 6, text });
  const { current, parent, present } = input;
  if ('failure' in current) add(`registre de dette illisible : ${current.failure}`);
  if (parent !== null && 'failure' in parent) {
    add(`registre de dette illisible au premier parent : ${parent.failure}`);
  }
  const entries = entriesOf(current);
  const ids = new Set<string>();
  for (const entry of entries) {
    const id = debtIdentity(entry);
    if (ids.has(id)) add(`${id} : identité en double dans le registre`);
    ids.add(id);
  }
  const before = parent === null || 'failure' in parent ? null : new Set(parent.survivors.map(debtIdentity));
  const added = before === null ? [] : [...ids].filter((id) => !before.has(id));
  for (const id of added) add(`${id} : entrée ajoutée au registre, le registre ne peut que rétrécir`);
  const removed = removedEntries(input);
  // The report as the checks below read it; none when it is unreadable (rule 5 says so, nothing is judged on it).
  const readable = 'failure' in report ? null : report;
  // A file the report speaks of: it has mutants, or it was mutated (config.mutate) and had none.
  const covered = (found: DebtReport, file: string) => found.files.has(file) || found.mutate.includes(file);
  // The identities of the mutants of one file of the report whose status passes `keep`.
  const identitiesOf = (found: DebtReport, file: string, keep: (status: string) => boolean): Set<string> => {
    const result = found.files.get(file);
    if (result === undefined) return new Set();
    return new Set(
      result.mutants
        .filter((mutant) => keep(mutant.status))
        .map((mutant) => debtIdentity(entryOf(file, mutant, result.source))),
    );
  };
  for (const entry of removed) {
    if (!present.has(entry.file) || readable === null) continue;
    const id = debtIdentity(entry);
    if (!covered(readable, entry.file))
      add(`${id} : retrait non prouvé, le fichier n'est pas dans le rapport de mutation`);
    else if (identitiesOf(readable, entry.file, (status) => NOT_KILLED.has(status)).has(id)) {
      add(`${id} : retrait refusé, le survivant existe toujours`);
    }
  }
  let notSurvived = 0;
  for (const entry of entries) {
    const id = debtIdentity(entry);
    if (!present.has(entry.file)) add(`${id} : fichier absent, entrée à retirer dans la même PR`);
    else if (readable !== null && covered(readable, entry.file)) {
      if (!identitiesOf(readable, entry.file, () => true).has(id)) {
        add(`${id} : introuvable (code supprimé ou déplacé), à retirer dans la même PR`);
      } else if (!identitiesOf(readable, entry.file, (status) => NOT_KILLED.has(status)).has(id)) {
        notSurvived++;
      }
    }
  }
  const summary: DebtSummary = {
    path: input.path,
    survivors: entries.length,
    accepted,
    notSurvived,
    added: parent === null ? ids.size : added.length,
    removed: removed.length,
    created: parent === null,
  };
  return { summary, violations };
}
