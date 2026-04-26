/**
 * Integration test stub — wiki-write → wiki-read round-trip.
 *
 * Tests the compose path: write a page via the handler, then read it back
 * via the read handler and assert byte-identical content.
 *
 * Uses an in-memory store to avoid filesystem dependencies.
 */

import { describe, it, expect } from "vitest";
import { handler as writeHandler } from "../../src/wiki/handlers/wiki-write.js";
import { handler as readHandler } from "../../src/wiki/handlers/wiki-read.js";
import { WikiExists, WikiMissing } from "../../src/wiki/types.js";

// ── In-memory store ───────────────────────────────────────────────────────

function makeMemoryStore(): {
  store: Map<string, string>;
  writePage: (root: string, relPath: string, content: string, mode: string) => Promise<{ path: string; mode: string; created: boolean; bytes_written: number }>;
  readPage: (root: string, relPath: string) => Promise<string | null>;
} {
  const store = new Map<string, string>();

  return {
    store,
    async writePage(root, relPath, content, mode) {
      const key = `${root}/${relPath}`;
      const existed = store.has(key);
      if (mode === "create" && existed) throw new WikiExists(relPath);
      if (mode === "append" && !existed) throw new WikiMissing(relPath);
      if (mode === "append") {
        const current = store.get(key) ?? "";
        store.set(key, current + (current.endsWith("\n") ? "\n" : "\n\n") + content);
      } else {
        store.set(key, content);
      }
      return {
        path: relPath,
        mode,
        created: !existed,
        bytes_written: Buffer.byteLength(content, "utf-8"),
      };
    },
    async readPage(root, relPath) {
      return store.get(`${root}/${relPath}`) ?? null;
    },
  };
}

describe("wiki-write → wiki-read round-trip", () => {
  const ROOT = "/test-wiki";

  it("creates and reads back a page with byte-identical content", async () => {
    const { writePage, readPage } = makeMemoryStore();
    const deps = { wikiRoot: ROOT, writePage, readPage };

    const content = "# Test Page\n\nThis is test content.\n";
    const writeResult = await writeHandler({ path: "notes/test.md", content }, deps);

    expect("error" in writeResult).toBe(false);
    if ("error" in writeResult) return;

    const readResult = await readHandler({ path: "notes/test.md" }, deps);
    expect("error" in readResult).toBe(false);
    if ("error" in readResult) return;

    expect(readResult.content).toBe(content);
    expect(readResult.path).toBe("notes/test.md");
  });

  it("returns error for missing path arg", async () => {
    const { writePage, readPage } = makeMemoryStore();
    const deps = { wikiRoot: ROOT, writePage, readPage };

    const result = await writeHandler({ path: "", content: "x" }, deps);
    expect("error" in result).toBe(true);
  });

  it("returns error for missing content arg", async () => {
    const { writePage, readPage } = makeMemoryStore();
    const deps = { wikiRoot: ROOT, writePage, readPage };

    const result = await writeHandler({ path: "notes/test.md" }, deps);
    expect("error" in result).toBe(true);
  });

  it("create mode rejects duplicate path", async () => {
    const { writePage, readPage } = makeMemoryStore();
    const deps = { wikiRoot: ROOT, writePage, readPage };

    await writeHandler({ path: "notes/dup.md", content: "first" }, deps);
    const second = await writeHandler({ path: "notes/dup.md", content: "second", mode: "create" }, deps);
    expect("error" in second).toBe(true);
    if ("error" in second) {
      expect(second.error).toContain("already exists");
    }
  });

  it("replace mode overwrites existing page", async () => {
    const { writePage, readPage } = makeMemoryStore();
    const deps = { wikiRoot: ROOT, writePage, readPage };

    await writeHandler({ path: "notes/rep.md", content: "original" }, deps);
    await writeHandler({ path: "notes/rep.md", content: "updated", mode: "replace" }, deps);
    const r = await readHandler({ path: "notes/rep.md" }, deps);
    if ("error" in r) throw new Error(r.error);
    expect(r.content).toBe("updated");
  });

  it("read returns error for missing page", async () => {
    const { readPage } = makeMemoryStore();
    const deps = { wikiRoot: ROOT, readPage };

    const result = await readHandler({ path: "notes/missing.md" }, deps);
    expect("error" in result).toBe(true);
  });
});
