import { parseArguments } from '../domain/arguments.js';
import type { BaseInput } from '../domain/count.js';
import { parseUnifiedDiff, wholeFile, type ChangedFile } from '../domain/diff.js';
import { isJobFeature, matchesAny, type Job } from '../domain/layout.js';
import { retiredFiles } from '../domain/debt.js';
import { perimeterOf } from '../domain/mutation.js';
import { baseOf, renderReport } from '../domain/report.js';
import type { StaticSet } from '../domain/run.js';
import { evaluate } from '../domain/verdict.js';
import { jobOf, parseGateBase, parseGateConfig, type GateConfig } from './config.js';
import { parseCucumberReport } from './cucumber-report.js';
import { generateDebt, readDebt } from './debt.js';
import { GitRepository } from './git.js';
import { compileFeature } from './gherkin.js';
import { jsonText } from './json.js';
import { parseMutationReport } from './mutation-report.js';
import { Workspace } from './workspace.js';

/** The descriptive configuration, relative to the repository root. */
export const CONFIG_PATH = 'tools/test-gate/gate.json';

export interface Output {
  write(text: string): unknown;
}

function staticSet(paths: readonly string[], read: (path: string) => string): StaticSet {
  const ids: string[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    const compiled = compileFeature(path, read(path));
    if ('failure' in compiled) errors.push(compiled.failure);
    else ids.push(...compiled);
  }
  return { ids, errors };
}

/** The diff against the first parent (every tracked file without one), plus untracked files as whole additions. */
export function changedFiles(
  repository: GitRepository,
  workspace: Workspace,
  firstParent: string | null,
): ChangedFile[] {
  const whole = (path: string) => wholeFile(path, workspace.read(path) as string);
  const present = (path: string) => workspace.read(path) !== null;
  return [
    ...(firstParent === null
      ? repository.tracked().filter(present).map(whole)
      : parseUnifiedDiff(repository.diff(firstParent))),
    ...repository.untracked().map(whole),
  ];
}

/** The mutation debt registry and the perimeter Stryker must mutate: rule 5's, plus the files of retired entries. */
function mutationScope(
  config: GateConfig,
  changes: readonly ChangedFile[],
  workspace: Workspace,
  repository: GitRepository,
  firstParent: string | null,
) {
  const debt = readDebt(config.debt, workspace, repository, firstParent);
  const production = workspace.glob(config.production);
  return { debt, perimeter: perimeterOf(config, changes, production, retiredFiles(debt, production)) };
}

function gate(
  config: GateConfig,
  job: Job,
  command: 'plan' | 'check',
  root: string,
  env: NodeJS.ProcessEnv,
  out: Output,
) {
  const workspace = new Workspace(root);
  const repository = new GitRepository(root);
  const { head, firstParent } = repository.commits();
  const changes = changedFiles(repository, workspace, firstParent);
  // A job without mutation does not read the mutation debt registry.
  const scope = job.mutation ? mutationScope(config, changes, workspace, repository, firstParent) : null;
  const reports = config.reports;
  if (command === 'plan') {
    const mutate = scope?.perimeter.files ?? [];
    workspace.write(reports.plan, jsonText({ job: job.name, head, firstParent, mutate }));
    out.write(`plan ${job.name} : ${mutate.length} fichier(s) à muter -> ${reports.plan}\n`);
    return 0;
  }
  const inJob = (path: string) => isJobFeature(config, job, path);
  const staticNow = staticSet(
    workspace.glob(config.features).filter(inJob),
    (path) => workspace.read(path) as string,
  );
  const staticParent =
    firstParent === null
      ? []
      : staticSet(repository.filesAt(firstParent).filter(inJob), (path) => repository.show(firstParent, path))
          .ids;
  const cucumber = workspace.read(reports.cucumber);
  const baseText = workspace.read(reports.base);
  const base: BaseInput = baseText === null ? null : parseGateBase(baseText);
  const mutationText = workspace.read(reports.mutation);
  const verdict = evaluate({
    job: job.name,
    head,
    firstParent,
    staticNow,
    staticParent,
    run:
      cucumber === null
        ? { failure: `${reports.cucumber} absent` }
        : parseCucumberReport(cucumber, (uri) => matchesAny(uri, job.features)),
    base,
    mutation:
      scope === null
        ? null
        : {
            ...scope,
            report:
              mutationText === null
                ? { failure: `${reports.mutation} absent` }
                : parseMutationReport(mutationText),
          },
  });
  const report = renderReport(verdict);
  workspace.write(reports.report, report);
  const summary = env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined && summary !== '') workspace.append(summary, report);
  if (verdict.green) workspace.write(reports.baseOut, jsonText(baseOf(verdict)));
  else workspace.remove(reports.baseOut);
  out.write(report);
  return verdict.green ? 0 : 1;
}

/**
 * `test-gate plan|check [--job <name>]` or `test-gate debt` run in `root`, the process argv as given by Node.
 * Returns the exit code: 0 green (or plan or debt registry written), 1 red or unusable input. Never throws on a bad input: it is reported and red.
 */
export function runGate(argv: readonly string[], root: string, env: NodeJS.ProcessEnv, out: Output): number {
  const refuse = (failure: string) => {
    out.write(`porte de test : ${failure}\n`);
    return 1;
  };
  const [, , ...args] = argv;
  const command = parseArguments(args);
  if ('failure' in command) return refuse(command.failure);
  const text = new Workspace(root).read(CONFIG_PATH);
  if (text === null) return refuse(`${CONFIG_PATH} absent`);
  const config = parseGateConfig(text);
  if ('failure' in config) return refuse(`${CONFIG_PATH} : ${config.failure}`);
  if (command.name === 'debt') {
    const written = generateDebt(config, new Workspace(root));
    if ('failure' in written) return refuse(written.failure);
    out.write(written.summary);
    return 0;
  }
  const job = jobOf(config, command.job);
  if (job === null) return refuse(`job inconnu : ${command.job}`);
  return gate(config, job, command.name, root, env, out);
}
