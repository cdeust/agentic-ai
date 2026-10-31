import {
  acceptedIdentities,
  debtIdentity,
  entryOf,
  judgeDebt,
  type DebtInput,
  type DebtSummary,
} from './debt.js';
import type { ChangedFile } from './diff.js';
import { componentOf, isProduction, isStepDefinition, inFileSet, type Layout } from './layout.js';
import type { ReadFailure, Violation } from './violation.js';

/**
 * Tests whose mutants enter the perimeter (b), as a prefix of the path of their .feature: the path of one .feature,
 * `<component>/` for every test of a component, `''` for every test.
 */
export type TestScope = string;

export interface Perimeter {
  /** (a) production files with changed lines, and those lines. */
  readonly changedLines: ReadonlyMap<string, ReadonlySet<number>>;
  /** (b) tests touched by the diff. */
  readonly scopes: readonly TestScope[];
  /** Production files whose every mutant is in (b) when the report carries no per-test coverage. */
  readonly fallbackFiles: readonly string[];
  /** Files rule 5 judges: (a), plus every production file when (b) is not empty. */
  readonly judged: readonly string[];
  /**
   * Files Stryker must mutate (`--mutate`): `judged`, plus the files of the entries the mutation debt registry lost,
   * so that rule 6 can prove their removal. Only rule 6 reads the mutants of the latter.
   */
  readonly files: readonly string[];
}

/**
 * The perimeter of rule 5 from the diff against the first parent and the production files of the working tree;
 * `retired` are the production files of the entries removed from the mutation debt registry.
 */
export function perimeterOf(
  layout: Layout,
  changes: readonly ChangedFile[],
  production: readonly string[],
  retired: readonly string[],
): Perimeter {
  const changedLines = new Map<string, ReadonlySet<number>>();
  const scopes: TestScope[] = [];
  const fallback = new Set<string>();
  const filesOf = (root: string | null) =>
    production.filter((file) => root === null || file.startsWith(`${root}/`));
  for (const change of changes) {
    const root = componentOf(layout, change.path);
    if (isProduction(layout, change.path) && change.lines.length > 0) {
      changedLines.set(change.path, new Set(change.lines));
    } else if (inFileSet(change.path, layout.features) && !change.deleted) {
      scopes.push(change.path);
      filesOf(root).forEach((file) => fallback.add(file));
    } else if (isStepDefinition(layout, change.path)) {
      scopes.push(root === null ? '' : `${root}/`);
      filesOf(root).forEach((file) => fallback.add(file));
    }
  }
  const judged = new Set([...changedLines.keys(), ...(scopes.length > 0 ? production : [])]);
  return {
    changedLines,
    scopes,
    fallbackFiles: [...fallback].sort(),
    judged: [...judged].sort(),
    files: [...new Set([...judged, ...retired])].sort(),
  };
}

/** What the gate keeps of a Stryker JSON report (mutation-testing-report-schema). */
export interface MutantRecord {
  readonly id: string;
  readonly mutatorName: string;
  readonly status: string;
  readonly startLine: number;
  /** Column of the start, from one. */
  readonly startColumn: number;
  readonly endLine: number;
  /** Column of the end, from one, exclusive. */
  readonly endColumn: number;
  /** The code of the mutant; empty when the report carries none. */
  readonly replacement: string;
  /** Test ids; null when the report measured no per-test coverage for this mutant. */
  readonly coveredBy: readonly string[] | null;
  readonly static: boolean;
}

export interface MutationReport {
  readonly files: ReadonlyMap<string, { readonly source: string; readonly mutants: readonly MutantRecord[] }>;
  /** Test id -> path of its .feature file (the report's testFiles). */
  readonly testFiles: ReadonlyMap<string, string>;
  /** config.mutate of the run: a file listed there but absent from `files` was mutated and had no mutant. */
  readonly mutate: readonly string[];
}

export interface JudgedMutant {
  readonly file: string;
  readonly mutant: MutantRecord;
}

export interface MutationJudgement {
  readonly perimeter: Perimeter;
  readonly mutants: readonly JudgedMutant[];
  readonly invalid: readonly string[];
  /** True when (b) had to use every mutant of the touched components: the report carried no coveredBy. */
  readonly coverageFallback: boolean;
  /** Rule 6 on the mutation debt registry; null when none was given. */
  readonly debt: DebtSummary | null;
  readonly violations: readonly Violation[];
}

const RED = new Set(['Survived', 'NoCoverage', 'Pending']);
/** The red statuses the mutation debt registry can accept; Pending is always red. */
const DEBT = new Set(['Survived', 'NoCoverage']);
const INVALID = new Set(['CompileError', 'RuntimeError']);
const DIRECTIVE = 'Stryker disable';
const NEXT_LINE = `// ${DIRECTIVE} next-line `;
const EQUIVALENT = ': équivalent: ';
/** A comment that starts a Stryker directive (Stryker reads `//` and block comments alike). */
const DIRECTIVE_COMMENT = /\/[/*]\s*Stryker\s+disable/;

/**
 * The mutators a well-formed justification names, or null when the line is not one. The invariant after the
 * separator cannot be empty: the line is trimmed and the separator ends with a space.
 */
export function justifiedMutators(line: string): readonly string[] | null {
  const text = line.trim();
  const at = text.indexOf(EQUIVALENT);
  if (!text.startsWith(NEXT_LINE) || at <= NEXT_LINE.length) return null;
  return text.slice(NEXT_LINE.length, at).split(',');
}

function label(file: string, mutant: MutantRecord): string {
  return `${file}:${mutant.startLine} ${mutant.mutatorName} #${mutant.id}`;
}

/**
 * Rule 5 on one report: statuses in the perimeter, form of every Stryker directive in its files. A Survived or
 * NoCoverage mutant of the mutation debt registry is accepted. Then rule 6 on that registry (null: no registry).
 */
export function judgeMutation(
  perimeter: Perimeter,
  report: MutationReport | ReadFailure,
  debt: DebtInput | null,
): MutationJudgement {
  const violations: Violation[] = [];
  const add = (text: string) => violations.push({ rule: 5, text });
  const mutants: JudgedMutant[] = [];
  const invalid: string[] = [];
  if ('failure' in report) {
    // `files`, not `judged`: a removal from the debt registry is proved by the report alone.
    if (perimeter.files.length > 0) add(`rapport de mutation illisible : ${report.failure}`);
    const unread = debt === null ? null : judgeDebt(debt, report, 0);
    violations.push(...(unread?.violations ?? []));
    return {
      perimeter,
      mutants,
      invalid,
      coverageFallback: false,
      debt: unread?.summary ?? null,
      violations,
    };
  }
  const known = debt === null ? new Set<string>() : acceptedIdentities(debt);
  let accepted = 0;
  const all = [...report.files.values()].flatMap((file) => file.mutants);
  const coverageFallback = perimeter.scopes.length > 0 && all.every((mutant) => mutant.coveredBy === null);
  // String(undefined) starts with no scope but '': a test id the report does not map is in "every test" only.
  const covers = (testId: string) =>
    perimeter.scopes.some((scope) => String(report.testFiles.get(testId)).startsWith(scope));
  for (const file of perimeter.judged) {
    const result = report.files.get(file);
    if (result === undefined) {
      if (!report.mutate.includes(file)) add(`${file} : fichier du périmètre absent du rapport de mutation`);
      continue;
    }
    const lines = result.source.split('\n');
    lines.forEach((line, index) => {
      if (DIRECTIVE_COMMENT.test(line) && justifiedMutators(line) === null) {
        add(`${file}:${index + 1} : directive Stryker refusée : ${line.trim()}`);
      }
    });
    for (const mutant of result.mutants) {
      const changed = perimeter.changedLines.get(file);
      const byLine =
        changed !== undefined && [...changed].some((n) => n >= mutant.startLine && n <= mutant.endLine);
      const byTest = coverageFallback
        ? perimeter.fallbackFiles.includes(file)
        : perimeter.scopes.length > 0 && (mutant.static || (mutant.coveredBy ?? []).some(covers));
      if (!byLine && !byTest) continue;
      mutants.push({ file, mutant });
      const justification = justifiedMutators(String(lines[mutant.startLine - 2]));
      if (RED.has(mutant.status)) {
        if (DEBT.has(mutant.status) && known.has(debtIdentity(entryOf(file, mutant, result.source))))
          accepted++;
        else add(`${label(file, mutant)} : ${mutant.status}`);
      }
      if (INVALID.has(mutant.status)) invalid.push(`${label(file, mutant)} : ${mutant.status}`);
      if (mutant.status === 'Ignored' && justification?.includes(mutant.mutatorName) !== true) {
        add(`${label(file, mutant)} : Ignored sans justification « équivalent » sur la ligne précédente`);
      }
    }
  }
  const judgedDebt = debt === null ? null : judgeDebt(debt, report, accepted);
  violations.push(...(judgedDebt?.violations ?? []));
  return { perimeter, mutants, invalid, coverageFallback, debt: judgedDebt?.summary ?? null, violations };
}
