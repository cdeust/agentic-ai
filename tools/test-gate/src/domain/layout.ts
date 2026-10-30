import { matchesGlob } from 'node:path';

/** The descriptive part of tools/test-gate/gate.json the rules need: which files are what. */
export interface Layout {
  readonly production: FileSet;
  readonly features: FileSet;
  readonly stepDefinitions: readonly string[];
  /** Component roots, e.g. `packages/*`, `data`. */
  readonly components: readonly string[];
}

export interface FileSet {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

export interface Job {
  readonly name: string;
  /** Scope of the job: the static set and the executed set are both restricted to these globs. */
  readonly features: readonly string[];
  readonly mutation: boolean;
}

// path.matchesGlob: node_modules/@types/node/path.d.ts.
export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}

export function inFileSet(path: string, set: FileSet): boolean {
  return matchesAny(path, set.include) && !matchesAny(path, set.exclude);
}

export function isProduction(layout: Layout, path: string): boolean {
  return inFileSet(path, layout.production);
}

export function isJobFeature(layout: Layout, job: Job, path: string): boolean {
  return inFileSet(path, layout.features) && matchesAny(path, job.features);
}

export function isStepDefinition(layout: Layout, path: string): boolean {
  return matchesAny(path, layout.stepDefinitions);
}

/** The component directory holding `path` (`packages/contracts`), or null for a root path (`features/...`). */
export function componentOf(layout: Layout, path: string): string | null {
  const segments = path.split('/');
  for (const component of layout.components) {
    const depth = component.split('/').length;
    const root = segments.slice(0, depth).join('/');
    if (segments.length > depth && matchesGlob(root, component)) return root;
  }
  return null;
}
