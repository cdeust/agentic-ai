/** Rules of doc §7 as restated by brick 1a.3: 1 identity, 2 outcome, 3 executed = static, 4 count, 5 mutation, 6 debt. */
export type RuleNumber = 1 | 2 | 3 | 4 | 5 | 6;

/** One broken rule. The gate lists every violation, never only the first. */
export interface Violation {
  readonly rule: RuleNumber;
  readonly text: string;
}

/** An input the gate could not read (absent or malformed file). It is a violation of the rule that needs it. */
export interface ReadFailure {
  readonly failure: string;
}
