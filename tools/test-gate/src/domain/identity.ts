/**
 * Identity of a pickle (doc §7, "Le compte" 2): path, Feature, Rule, Scenario, Examples name and the literal cells of
 * the Examples row. Text, never a hash: two pickles are the same pickle when these six values are equal.
 */
export interface PickleIdentity {
  readonly path: string;
  readonly feature: string;
  /** null outside a Rule. */
  readonly rule: string | null;
  /** The Scenario name as written, placeholders unresolved. */
  readonly scenario: string;
  /** null for a plain Scenario; the Examples name (possibly empty) for a row of a Scenario Outline. */
  readonly examples: string | null;
  readonly cells: readonly string[] | null;
}

/** The text form used everywhere (sets, reports, gate-base.json): a JSON array, unambiguous whatever the names hold. */
export function identityText(identity: PickleIdentity): string {
  return JSON.stringify([
    identity.path,
    identity.feature,
    identity.rule,
    identity.scenario,
    identity.examples,
    identity.cells,
  ]);
}
