import type { MutantStatus } from 'mutation-testing-report-schema';
import { z } from 'zod';
import type { MutationReport } from '../domain/mutation.js';
import type { ReadFailure } from '../domain/violation.js';
import { parseJson } from './json.js';

// The fields the gate reads of a Stryker JSON report: MutationTestResult, FileResult, MutantResult, Location and
// TestFile in node_modules/mutation-testing-report-schema/dist/src-generated/schema.d.ts. Other fields are ignored.
const STATUSES = [
  'Killed',
  'Survived',
  'NoCoverage',
  'CompileError',
  'RuntimeError',
  'Timeout',
  'Ignored',
  'Pending',
] as const satisfies readonly MutantStatus[];

const Position = z.object({ line: z.number().int().positive(), column: z.number().int() });

const ReportSchema = z.object({
  files: z.record(
    z.string(),
    z.object({
      source: z.string(),
      mutants: z.array(
        z.object({
          id: z.string(),
          mutatorName: z.string(),
          status: z.enum(STATUSES),
          location: z.object({ start: Position, end: Position }),
          coveredBy: z.array(z.string()).optional(),
          static: z.boolean().optional(),
        }),
      ),
    }),
  ),
  testFiles: z.record(z.string(), z.object({ tests: z.array(z.object({ id: z.string() })) })),
  config: z.object({ mutate: z.array(z.string()) }),
});

/** Parses reports/mutation/mutation.json into what rule 5 needs. */
export function parseMutationReport(text: string): MutationReport | ReadFailure {
  const parsed = parseJson(ReportSchema, text);
  if ('failure' in parsed) return parsed;
  const { files, testFiles, config } = parsed;
  return {
    files: new Map(
      Object.entries(files).map(([path, file]) => [
        path,
        {
          source: file.source,
          mutants: file.mutants.map((mutant) => ({
            id: mutant.id,
            mutatorName: mutant.mutatorName,
            status: mutant.status,
            startLine: mutant.location.start.line,
            endLine: mutant.location.end.line,
            coveredBy: mutant.coveredBy ?? null,
            static: mutant.static ?? false,
          })),
        },
      ]),
    ),
    testFiles: new Map(
      Object.entries(testFiles).flatMap(([path, file]) => file.tests.map((test) => [test.id, path] as const)),
    ),
    mutate: config.mutate,
  };
}
