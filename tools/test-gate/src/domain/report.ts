import type { GateBase } from './count.js';
import type { RuleNumber } from './violation.js';
import type { Verdict } from './verdict.js';

const RULES: readonly (readonly [RuleNumber, string])[] = [
  [1, 'Règle 1, identité des pickles'],
  [2, 'Règle 2, une tentative, chaque step PASSED'],
  [3, 'Règle 3, exécutés = statique'],
  [4, 'Règle 4, exécutés = base + ajoutés − supprimés'],
  [5, 'Règle 5, mutation'],
  [6, 'Règle 6, dette de mutation'],
];

function list(items: readonly string[], none = '- aucun'): string[] {
  return items.length === 0 ? [none] : items.map((item) => `- ${item}`);
}

function baseLine(verdict: Verdict): string {
  const { count, firstParent } = verdict;
  if (count.source === 'artifact')
    return `base : ${count.base}, artefact gate-base.json du dernier run vert de main`;
  if (count.source === 'root') return 'base : 0, aucun premier parent, tout est ajouté';
  return `base : repli, compte statique du premier parent ${String(firstParent)}, aucun run vert de main pour ce SHA (${count.base})`;
}

function mutationLines(verdict: Verdict): string[] {
  const { mutation } = verdict;
  if (mutation === null) return ['Mutation désactivée pour ce job.'];
  const statuses = new Map<string, number>();
  for (const { mutant } of mutation.mutants)
    statuses.set(mutant.status, (statuses.get(mutant.status) ?? 0) + 1);
  return [
    `- fichiers du périmètre : ${mutation.perimeter.judged.length}`,
    `- mutants du périmètre : ${mutation.mutants.length}`,
    ...[...statuses].sort().map(([status, n]) => `  - ${status} : ${n}`),
    ...(mutation.coverageFallback
      ? ['- couverture par test absente du rapport : (b) = tous les mutants des composants touchés']
      : []),
    '- mutants invalides (signalés, pas rouges) :',
    ...list(mutation.invalid).map((line) => `  ${line}`),
  ];
}

/** The mutation debt section, only for a job with mutation. */
function debtLines(verdict: Verdict): string[] {
  const { mutation } = verdict;
  if (mutation === null) return [];
  const { debt } = mutation;
  return [
    '## Dette de mutation',
    '',
    `- registre : ${debt.path}`,
    `- survivants au registre : ${debt.survivors}`,
    `- rencontrés dans le périmètre de ce run : ${debt.accepted}`,
    `- entrées dont le mutant n'a pas survécu à ce run : ${debt.notSurvived} (à retirer du registre quand la dette est payée)`,
    `- entrées ajoutées par ce diff : ${debt.added}`,
    `- entrées retirées par ce diff : ${debt.removed}`,
    ...(debt.created ? ["- création du registre par ce diff (le premier parent n'en a pas)"] : []),
    '',
  ];
}

/** reports/gate-report.md, also appended to $GITHUB_STEP_SUMMARY. */
export function renderReport(verdict: Verdict): string {
  const { count } = verdict;
  const lines = [
    `# Porte de test, job ${verdict.job} : ${verdict.green ? 'VERTE' : 'ROUGE'}`,
    '',
    `- tête : ${verdict.head}`,
    `- premier parent : ${verdict.firstParent ?? 'aucun'}`,
    `- exécutés : ${verdict.executed.length}`,
    `- statique : ${verdict.staticCount}`,
    `- ${baseLine(verdict)}`,
    `- attendu : base ${count.base} + ajoutés ${count.added.length} − supprimés ${count.removed.length} = ${count.expected}`,
    `- +${count.added.length} −${count.removed.length}`,
    '',
    `## Ajoutés (+${count.added.length})`,
    '',
    ...list(count.added),
    '',
    `## Supprimés (−${count.removed.length})`,
    '',
    ...list(count.removed),
    '',
    ...debtLines(verdict),
    '## Violations',
  ];
  for (const [rule, title] of RULES) {
    const texts = verdict.violations
      .filter((violation) => violation.rule === rule)
      .map((violation) => violation.text);
    lines.push('', `### ${title}`, '', ...list(texts, '- aucune'));
  }
  lines.push('', '## Mutation', '', ...mutationLines(verdict), '');
  return lines.join('\n');
}

/** reports/gate-base.json: what the next run of a child commit reads as its base. Only written when green. */
export function baseOf(verdict: Verdict): GateBase {
  return {
    job: verdict.job,
    sha: verdict.head,
    count: verdict.executed.length,
    pickles: [...verdict.executed].sort(),
  };
}
