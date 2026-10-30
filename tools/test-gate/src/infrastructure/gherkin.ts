import { AstBuilder, GherkinClassicTokenMatcher, Parser, compile } from '@cucumber/gherkin';
import {
  IdGenerator,
  type Feature,
  type GherkinDocument,
  type Pickle,
  type Scenario,
} from '@cucumber/messages';
import { identityText } from '../domain/identity.js';
import type { ReadFailure } from '../domain/violation.js';

interface ScenarioEntry {
  readonly rule: string | null;
  readonly name: string;
}

interface RowEntry {
  readonly examples: string;
  readonly cells: readonly string[];
}

/**
 * Identity text of each pickle of one document, keyed by pickle id. astNodeIds of a pickle are [scenario] or
 * [scenario, examples row] (node_modules/@cucumber/gherkin/dist/src/pickles/compile.js); the gherkin compiler
 * guarantees both ids exist in the document, hence the casts.
 */
export function identitiesOf(document: GherkinDocument, pickles: readonly Pickle[]): Map<string, string> {
  const scenarios = new Map<string, ScenarioEntry>();
  const rows = new Map<string, RowEntry>();
  const visit = (scenario: Scenario, rule: string | null) => {
    scenarios.set(scenario.id, { rule, name: scenario.name });
    for (const examples of scenario.examples) {
      for (const row of examples.tableBody) {
        rows.set(row.id, { examples: examples.name, cells: row.cells.map((cell) => cell.value) });
      }
    }
  };
  const feature = document.feature as Feature;
  for (const child of feature.children) {
    if (child.scenario !== undefined) visit(child.scenario, null);
    if (child.rule !== undefined) {
      const rule = child.rule;
      for (const ruleChild of rule.children) {
        if (ruleChild.scenario !== undefined) visit(ruleChild.scenario, rule.name);
      }
    }
  }
  return new Map(
    pickles.map((pickle) => {
      const [scenarioId, rowId] = pickle.astNodeIds;
      const scenario = scenarios.get(scenarioId as string) as ScenarioEntry;
      const row = rows.get(rowId as string);
      const identity = {
        path: pickle.uri,
        feature: feature.name,
        rule: scenario.rule,
        scenario: scenario.name,
        examples: row?.examples ?? null,
        cells: row?.cells ?? null,
      };
      return [pickle.id, identityText(identity)];
    }),
  );
}

/**
 * The pickle identities of one .feature file, compiled as cucumber-js does (GherkinClassicTokenMatcher, Parser,
 * AstBuilder, compile with an IdGenerator: node_modules/@cucumber/gherkin/dist/src/generateMessages.js).
 */
export function compileFeature(uri: string, text: string): string[] | ReadFailure {
  const newId = IdGenerator.incrementing();
  const parser = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher());
  try {
    const document = { ...parser.parse(text), uri };
    if (document.feature === undefined) return [];
    return [...identitiesOf(document, compile(document, uri, newId)).values()];
  } catch (error) {
    return { failure: `${uri} : ${(error as Error).message.replaceAll('\n', ' ')}` };
  }
}
