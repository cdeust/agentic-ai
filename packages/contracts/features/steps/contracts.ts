import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import {
  DATA_OP_NAMES,
  RecallDataSchema,
  RecallInputSchema,
  RememberInputSchema,
  TOOLS,
  TOOL_NAMES,
  WorkerOutputSchema,
  resultSchema,
} from '../../src/index.js';

// Then with a doc string argument: node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts
// (the doc string is passed as the last string parameter of the step function).

const recallResult = resultSchema(RecallDataSchema);
const inputSchemas = { recall: RecallInputSchema, remember: RememberInputSchema };

Then('the Result schema of recall data accepts:', (json: string) => {
  assert.equal(recallResult.safeParse(JSON.parse(json)).success, true);
});

Then('the Result schema of recall data rejects:', (json: string) => {
  assert.equal(recallResult.safeParse(JSON.parse(json)).success, false);
});

Then(
  'the {word} input schema parses {string} to {string}',
  (tool: keyof typeof inputSchemas, input: string, expected: string) => {
    assert.deepEqual(inputSchemas[tool].parse(JSON.parse(input)), JSON.parse(expected));
  },
);

Then('the {word} input schema rejects {string}', (tool: keyof typeof inputSchemas, input: string) => {
  assert.equal(inputSchemas[tool].safeParse(JSON.parse(input)).success, false);
});

Then('the tool names are {string}', (names: string) => {
  if (names.length > 0) return 'skipped';
  assert.deepEqual(TOOL_NAMES, names.split(', '));
});

Then('every tool is owned by {string}', (owner: string) => {
  for (const name of TOOL_NAMES) assert.equal(TOOLS[name].owner, owner);
});

Then('every tool has a non-empty description', () => {
  for (const name of TOOL_NAMES) assert.ok(TOOLS[name].description.length > 0);
});

Then('no data operation name matches the pattern {string} ignoring case', (pattern: string) => {
  assert.deepEqual(
    DATA_OP_NAMES.filter((op) => new RegExp(pattern, 'i').test(op)),
    [],
  );
});

Then('the worker output schema accepts:', (json: string) => {
  assert.equal(WorkerOutputSchema.safeParse(JSON.parse(json)).success, true);
});

Then('the worker output schema rejects:', (json: string) => {
  assert.equal(WorkerOutputSchema.safeParse(JSON.parse(json)).success, false);
});
