// Cucumber configuration. Options: node_modules/@cucumber/cucumber/lib/configuration/types.d.ts.
// tsx refuses to be a --loader (node_modules/tsx/dist/register-*.mjs), so it is registered here with its documented
// ESM API (node_modules/tsx/package.json exports './esm/api'); cucumber imports the support code after this file.
// tsx reads TSX_TSCONFIG_PATH: features/tsconfig.json carries the `paths` that map @architect-os/contracts to its sources.
import { register } from 'tsx/esm/api';

process.env['TSX_TSCONFIG_PATH'] ??= new URL('./features/tsconfig.json', import.meta.url).pathname;
register();

const COMPONENTS = ['packages/*', 'data', 'gateway', 'services/*', 'tools/*'];

const config = {
  paths: ['features/**/*.feature', ...COMPONENTS.map((c) => `${c}/features/**/*.feature`)],
  import: [
    'features/support/**/*.ts',
    'features/steps/**/*.ts',
    ...COMPONENTS.map((c) => `${c}/features/steps/**/*.ts`),
  ],
  format: ['message:reports/cucumber.ndjson', 'progress'],
  tags: 'not @postgres',
  retry: 0,
  strict: true,
};

export default config;

// The gate-macos job (docs/design/platform-v3-srt.md §7) runs features/sandbox only: `cucumber-js --profile macos`.
// A scope by path, not a filter: tools/test-gate/gate.json scopes the static count of the job identically.
export const macos = { ...config, paths: ['features/sandbox/**/*.feature'] };

// The mutation profile is used only by Stryker (stryker.config.mjs: cucumber.profile). Stryker runs the tests in a
// sandbox copy (.stryker-tmp/sandbox-*) of instrumented, unformatted sources. features/repository holds the typecheck
// and the format scenarios, which run tsc and prettier in child processes: they cover no production line in-process
// and can kill no mutant, and on the copy they fail by design. They stay in the default profile (the counted run,
// `npm test`, the gate). A scope by path, like `macos`: `features/**` is spelled as the root areas other than
// repository; features/descriptive/cucumber-profiles.feature checks that no area is forgotten.
const ROOT_AREAS = ['arch', 'descriptive', 'infra', 'integration', 'sandbox'];
export const mutation = {
  ...config,
  paths: [
    ...ROOT_AREAS.map((area) => `features/${area}/**/*.feature`),
    ...COMPONENTS.map((c) => `${c}/features/**/*.feature`),
  ],
};
