Feature: Architecture guard (dependency-cruiser)
  The guard of `npm run arch` is green on the tree and red on each kind of violation. Each fixture is a temporary
  file that breaks exactly one architecture rule. A new rule in .dependency-cruiser.cjs adds a row here.

  Scenario: the architecture guard is green on the real tree
    Given no architecture fixture file is left over
    When the architecture guard runs
    Then the architecture guard reports no violation

  Scenario: the architecture guard catches every kind of violation on temporary fixtures, then is green again once they are removed
    Given no architecture fixture file is left over
    And these temporary architecture fixtures exist:
      | file                                                    | code                                                      | rule                                          |
      | gateway/src/domain/zz-fixture-domain.ts                 | import '../infrastructure/in-memory.js';                  | domain-imports-only-domain-and-contracts      |
      | gateway/src/application/zz-fixture-application.ts       | import '../infrastructure/in-memory.js';                  | application-imports-only-domain               |
      | gateway/src/infrastructure/zz-fixture-infrastructure.ts | import '../presentation/mcp-server.js';                   | infrastructure-imports-domain-application     |
      | gateway/src/presentation/zz-fixture-presentation.ts     | import '../domain/errors.js';                             | presentation-imports-application              |
      | gateway/src/application/zz-fixture-root.ts              | import '../main.js';                                      | composition-root-is-not-imported-by-layers    |
      | gateway/src/application/zz-fixture-cross.ts             | import '../../../data/src/domain/ports.js';               | no-import-between-components                  |
      | gateway/src/application/zz-fixture-pg.ts                | import 'pg';                                              | pg-only-in-data-infrastructure                |
      | gateway/src/infrastructure/zz-fixture-sdk.ts            | import '@anthropic-ai/claude-agent-sdk';                  | agent-sdk-only-in-worker                      |
      | gateway/src/domain/zz-fixture-mcp.ts                    | import '@modelcontextprotocol/sdk/server/mcp.js';         | mcp-sdk-only-in-presentation-and-infrastructure |
      | services/memory/worker/zz-fixture-worker.ts             | import '../src/domain/ports.js';                          | worker-is-self-contained                      |
      | packages/contracts/src/zz-fixture-contracts.ts          | import '../../../gateway/src/domain/ports.js';            | contracts-has-no-component-dependency         |
      | gateway/src/infrastructure/zz-fixture-spawn.ts          | import 'node:child_process';                              | child-process-only-in-sandbox                 |
      | services/memory/src/infrastructure/zz-fixture-spawn.ts  | import 'child_process';                                   | child-process-only-in-sandbox                 |
      | tools/test-gate/src/infrastructure/zz-fixture-spawn.ts | import 'node:child_process';                              | child-process-only-in-sandbox                 |
      | tools/test-gate/src/domain/zz-fixture-domain.ts         | import '../infrastructure/git.js';                        | domain-imports-only-domain-and-contracts      |
      | gateway/src/infrastructure/zz-fixture-srt.ts            | import '@anthropic-ai/sandbox-runtime';                   | sandbox-runtime-only-in-sandbox               |
      | data/src/domain/zz-fixture-cycle-a.ts                   | import './zz-fixture-cycle-b.js';\nexport const a = 1;    | no-circular                                   |
      | data/src/domain/zz-fixture-cycle-b.ts                   | import './zz-fixture-cycle-a.js';\nexport const b = 1;    | no-circular                                   |
    When the architecture guard runs
    Then the architecture guard flags each fixture with its rule
    When the temporary architecture fixtures are removed
    And the architecture guard runs
    Then the architecture guard reports no violation
