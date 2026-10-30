/**
 * Architecture guard (npm run arch). Rules mirror docs/architecture.md and CLAUDE.md.
 * Component = gateway | services/<name> | data | tools/<name>. Layers live in <component>/src/{domain,application,infrastructure,presentation}.
 */
const COMPONENT = '^(gateway|services/[^/]+|data|tools/[^/]+)/';
const CONTRACTS = '^packages/contracts/';
const LOCAL_TYPES = ['local', 'aliased', 'aliased-tsconfig', 'aliased-subpath-import', 'aliased-workspace'];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'No import cycles anywhere.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-imports-only-domain-and-contracts',
      comment: 'domain imports only domain and @architect-os/contracts (and Node built-ins).',
      severity: 'error',
      from: { path: `${COMPONENT}src/domain/` },
      to: { pathNot: [`^$1/src/domain/`, CONTRACTS], dependencyTypesNot: ['core'] },
    },
    {
      name: 'application-imports-only-domain',
      comment: 'application depends on domain (and contracts), never on adapters or presentation.',
      severity: 'error',
      from: { path: `${COMPONENT}src/application/` },
      to: { pathNot: [`^$1/src/(domain|application)/`, CONTRACTS], dependencyTypesNot: ['core'] },
    },
    {
      name: 'infrastructure-imports-domain-application',
      comment:
        'infrastructure adapters implement domain ports; they do not reach presentation or the composition root.',
      severity: 'error',
      from: { path: `${COMPONENT}src/infrastructure/` },
      to: {
        pathNot: [`^$1/src/(domain|application|infrastructure)/`, CONTRACTS],
        dependencyTypes: LOCAL_TYPES,
      },
    },
    {
      name: 'presentation-imports-application',
      comment: 'presentation calls application use cases only.',
      severity: 'error',
      from: { path: `${COMPONENT}src/presentation/` },
      to: { pathNot: [`^$1/src/(application|presentation)/`, CONTRACTS], dependencyTypes: LOCAL_TYPES },
    },
    {
      name: 'composition-root-is-not-imported-by-layers',
      comment: 'src/main.ts is the single composition root; no layer may import it.',
      severity: 'error',
      from: { path: `${COMPONENT}src/(domain|application|infrastructure|presentation)/` },
      to: { path: `${COMPONENT}src/main\\.ts$` },
    },
    {
      name: 'no-import-between-components',
      comment: 'Components talk over the network. The only shared code is packages/contracts.',
      severity: 'error',
      from: { path: COMPONENT },
      to: { path: COMPONENT, pathNot: ['^$1/'] },
    },
    {
      name: 'contracts-has-no-component-dependency',
      comment: 'packages/contracts holds schemas and types only; it never imports a component.',
      severity: 'error',
      from: { path: CONTRACTS },
      to: { path: COMPONENT },
    },
    {
      name: 'worker-is-self-contained',
      comment: 'A worker image contains the worker and contracts only, never the service sources.',
      severity: 'error',
      from: { path: '^services/[^/]+/worker/' },
      to: { path: '^services/[^/]+/(src|test)/' },
    },
    {
      name: 'pg-only-in-data-infrastructure',
      comment: 'Only data/src/infrastructure may import pg. No database access outside data.',
      severity: 'error',
      from: { pathNot: '^data/src/infrastructure/' },
      to: { path: '(^|/)node_modules/(@types/)?pg(/|$)' },
    },
    {
      name: 'agent-sdk-only-in-worker',
      comment: 'The Claude Agent SDK runs only inside a worker image: services/<name>/worker.',
      severity: 'error',
      from: { pathNot: '^services/[^/]+/worker/' },
      to: { path: '(^|/)node_modules/@anthropic-ai/claude-agent-sdk(/|$)' },
    },
    {
      name: 'mcp-sdk-only-in-presentation-and-infrastructure',
      comment:
        'The MCP SDK is allowed in presentation/infrastructure of gateway and services (and in their step definitions).',
      severity: 'error',
      from: { pathNot: '^(gateway|services/[^/]+)/(src/(presentation|infrastructure)|features)/' },
      to: { path: '(^|/)node_modules/@modelcontextprotocol/sdk(/|$)' },
    },
    {
      name: 'child-process-only-in-sandbox',
      comment:
        'Process launching lives behind the SandboxRunner port (docs/design/platform-v3-srt.md, §6). Named exceptions: ' +
        'services/memory/src/infrastructure/docker-runner.ts, which moves behind the port in brick 1b.1; ' +
        'tools/test-gate/src/infrastructure/git.ts, the single file through which the CI gate runs git (§7).',
      severity: 'error',
      from: {
        pathNot: [
          '^packages/sandbox/',
          '^services/memory/src/infrastructure/docker-runner\\.ts$',
          '^tools/test-gate/src/infrastructure/git\\.ts$',
        ],
      },
      to: { path: '^(node:)?child_process$', dependencyTypes: ['core'] },
    },
    {
      name: 'sandbox-runtime-only-in-sandbox',
      comment:
        'srt (@anthropic-ai/sandbox-runtime) is reached only by packages/sandbox (platform-v3-srt.md, §6).',
      severity: 'error',
      from: { pathNot: '^packages/sandbox/' },
      to: { path: '(^|/)node_modules/@anthropic-ai/sandbox-runtime(/|$)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    exclude: { path: '^(packages/[^/]+|data|gateway|services/[^/]+|tools/[^/]+)/dist/' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'node', 'default'] },
  },
};
