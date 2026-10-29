import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEPCRUISE = join(ROOT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');
const TARGETS = ['packages', 'data', 'gateway', 'services'];

interface Violation {
  rule: { name: string };
  from: string;
  to: string;
}

function cruise(): Violation[] {
  let stdout: string;
  try {
    stdout = execFileSync(
      'node',
      [DEPCRUISE, '--config', '.dependency-cruiser.cjs', '--output-type', 'json', ...TARGETS],
      {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (error) {
    // depcruise exits non-zero when an error-severity rule is violated; the report is still on stdout.
    stdout = (error as { stdout: string }).stdout;
  }
  return (JSON.parse(stdout) as { summary: { violations: Violation[] } }).summary.violations;
}

/** Each fixture is a temporary file that breaks exactly one architecture rule. */
const FIXTURES: { file: string; code: string; rule: string }[] = [
  {
    file: 'gateway/src/domain/zz-fixture-domain.ts',
    code: "import '../infrastructure/in-memory.js';",
    rule: 'domain-imports-only-domain-and-contracts',
  },
  {
    file: 'gateway/src/application/zz-fixture-application.ts',
    code: "import '../infrastructure/in-memory.js';",
    rule: 'application-imports-only-domain',
  },
  {
    file: 'gateway/src/infrastructure/zz-fixture-infrastructure.ts',
    code: "import '../presentation/mcp-server.js';",
    rule: 'infrastructure-imports-domain-application',
  },
  {
    file: 'gateway/src/presentation/zz-fixture-presentation.ts',
    code: "import '../domain/errors.js';",
    rule: 'presentation-imports-application',
  },
  {
    file: 'gateway/src/application/zz-fixture-root.ts',
    code: "import '../main.js';",
    rule: 'composition-root-is-not-imported-by-layers',
  },
  {
    file: 'gateway/src/application/zz-fixture-cross.ts',
    code: "import '../../../data/src/domain/ports.js';",
    rule: 'no-import-between-components',
  },
  {
    file: 'gateway/src/application/zz-fixture-pg.ts',
    code: "import 'pg';",
    rule: 'pg-only-in-data-infrastructure',
  },
  {
    file: 'gateway/src/infrastructure/zz-fixture-sdk.ts',
    code: "import '@anthropic-ai/claude-agent-sdk';",
    rule: 'agent-sdk-only-in-worker',
  },
  {
    file: 'gateway/src/domain/zz-fixture-mcp.ts',
    code: "import '@modelcontextprotocol/sdk/server/mcp.js';",
    rule: 'mcp-sdk-only-in-presentation-and-infrastructure',
  },
  {
    file: 'services/memory/worker/zz-fixture-worker.ts',
    code: "import '../src/domain/ports.js';",
    rule: 'worker-is-self-contained',
  },
  {
    file: 'packages/contracts/src/zz-fixture-contracts.ts',
    code: "import '../../../gateway/src/domain/ports.js';",
    rule: 'contracts-has-no-component-dependency',
  },
  {
    file: 'data/src/domain/zz-fixture-cycle-a.ts',
    code: "import './zz-fixture-cycle-b.js';\nexport const a = 1;",
    rule: 'no-circular',
  },
  {
    file: 'data/src/domain/zz-fixture-cycle-b.ts',
    code: "import './zz-fixture-cycle-a.js';\nexport const b = 1;",
    rule: 'no-circular',
  },
];

const paths = FIXTURES.map((f) => join(ROOT, f.file));
const cleanup = () => paths.forEach((p) => existsSync(p) && rmSync(p));

describe('architecture guard (dependency-cruiser)', () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it('is green on the real tree', () => {
    expect(cruise()).toEqual([]);
  });

  it('catches every kind of violation on temporary fixtures, then is green again once they are removed', () => {
    for (const fixture of FIXTURES) {
      mkdirSync(dirname(join(ROOT, fixture.file)), { recursive: true });
      writeFileSync(join(ROOT, fixture.file), `${fixture.code}\nexport {};\n`);
    }
    try {
      const violations = cruise();
      for (const fixture of FIXTURES) {
        const caught = violations.some(
          (v) => v.rule.name === fixture.rule && (v.from === fixture.file || v.to === fixture.file),
        );
        expect(caught, `rule ${fixture.rule} should flag ${fixture.file}`).toBe(true);
      }
    } finally {
      cleanup();
    }
    expect(cruise()).toEqual([]);
  });
});
