// Cucumber configuration. Options: node_modules/@cucumber/cucumber/lib/configuration/types.d.ts.
// tsx refuses to be a --loader (node_modules/tsx/dist/register-*.mjs), so it is registered here with its documented
// ESM API (node_modules/tsx/package.json exports './esm/api'); cucumber imports the support code after this file.
// tsx reads TSX_TSCONFIG_PATH: features/tsconfig.json carries the `paths` that map @architect-os/contracts to its sources.
import { register } from 'tsx/esm/api';

process.env['TSX_TSCONFIG_PATH'] ??= new URL('./features/tsconfig.json', import.meta.url).pathname;
register();

const COMPONENTS = ['packages/*', 'data', 'gateway', 'services/*', 'tools/*'];

export default {
  paths: ['features/**/*.feature', ...COMPONENTS.map((c) => `${c}/features/**/*.feature`)],
  import: [
    'features/support/**/*.ts',
    'features/steps/**/*.ts',
    ...COMPONENTS.map((c) => `${c}/features/steps/**/*.ts`),
  ],
  format: ['message:reports/cucumber.ndjson', 'progress'],
  retry: 0,
  strict: true,
};
