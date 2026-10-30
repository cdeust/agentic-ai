import {
  appendFileSync,
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { FileSet } from '../domain/layout.js';

/** The working tree, paths relative to its root (absolute paths are taken as they are). */
export class Workspace {
  constructor(private readonly root: string) {}

  /** Sorted relative paths; `exclude` also prunes the walk (fs.globSync options: node_modules/@types/node/fs.d.ts). */
  glob(set: FileSet): string[] {
    return globSync([...set.include], { cwd: this.root, exclude: [...set.exclude] }).sort();
  }

  /** The text of a file, null when it does not exist. */
  read(path: string): string | null {
    const file = resolve(this.root, path);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  }

  write(path: string, text: string): void {
    const file = resolve(this.root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }

  append(path: string, text: string): void {
    appendFileSync(resolve(this.root, path), text);
  }

  remove(path: string): void {
    rmSync(resolve(this.root, path), { force: true });
  }
}
