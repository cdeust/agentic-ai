/**
 * Unit tests for infrastructure/file-io.ts
 *
 * Invariants:
 *   - readJson returns null on missing file (never throws)
 *   - writeJson creates parent directories
 *   - listDir returns null on missing directory (never throws)
 *
 * source: Cortex mcp_server/infrastructure/file_io.py
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  readJson,
  writeJson,
  readTextFile,
  ensureDir,
  listDir,
  statFile,
} from "../../src/infrastructure/file-io.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "file-io-test-"));
}

describe("readJson", () => {
  it("returns null for a missing file", () => {
    expect(readJson("/non/existent/path.json")).toBeNull();
  });

  it("parses a valid JSON file", () => {
    const dir = tempDir();
    const p = path.join(dir, "data.json");
    fs.writeFileSync(p, JSON.stringify({ x: 1 }));
    expect(readJson(p)).toEqual({ x: 1 });
    fs.rmSync(dir, { recursive: true });
  });

  it("returns null for malformed JSON", () => {
    const dir = tempDir();
    const p = path.join(dir, "bad.json");
    fs.writeFileSync(p, "not json");
    expect(readJson(p)).toBeNull();
    fs.rmSync(dir, { recursive: true });
  });
});

describe("writeJson", () => {
  it("creates the file with parent directories", () => {
    const dir = tempDir();
    const p = path.join(dir, "deep", "nested", "out.json");
    writeJson(p, { hello: "world" });
    expect(fs.existsSync(p)).toBe(true);
    const content = JSON.parse(fs.readFileSync(p, "utf-8")) as unknown;
    expect(content).toEqual({ hello: "world" });
    fs.rmSync(dir, { recursive: true });
  });

  it("uses 2-space indentation (idempotency check)", () => {
    const dir = tempDir();
    const p = path.join(dir, "out.json");
    const data = { a: 1, b: [2, 3] };
    writeJson(p, data);
    const text = fs.readFileSync(p, "utf-8");
    expect(text).toBe(JSON.stringify(data, null, 2));
    fs.rmSync(dir, { recursive: true });
  });
});

describe("readTextFile", () => {
  it("returns null for missing file", () => {
    expect(readTextFile("/no/such/file.txt")).toBeNull();
  });

  it("reads file contents as string", () => {
    const dir = tempDir();
    const p = path.join(dir, "hello.txt");
    fs.writeFileSync(p, "hello world", "utf-8");
    expect(readTextFile(p)).toBe("hello world");
    fs.rmSync(dir, { recursive: true });
  });
});

describe("ensureDir", () => {
  it("creates nested directories without error", () => {
    const dir = tempDir();
    const nested = path.join(dir, "a", "b", "c");
    ensureDir(nested);
    expect(fs.statSync(nested).isDirectory()).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it("is idempotent — calling twice does not throw", () => {
    const dir = tempDir();
    ensureDir(dir);
    ensureDir(dir);
    fs.rmSync(dir, { recursive: true });
  });
});

describe("listDir", () => {
  it("returns null for missing directory", () => {
    expect(listDir("/no/such/dir")).toBeNull();
  });

  it("returns entry names for an existing directory", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "a.txt"), "");
    fs.writeFileSync(path.join(dir, "b.txt"), "");
    const entries = listDir(dir);
    expect(entries).not.toBeNull();
    expect(entries!.sort()).toEqual(["a.txt", "b.txt"]);
    fs.rmSync(dir, { recursive: true });
  });
});

describe("statFile", () => {
  it("returns null for missing file", () => {
    expect(statFile("/no/such/file")).toBeNull();
  });

  it("returns Stats for existing file", () => {
    const dir = tempDir();
    const p = path.join(dir, "f.txt");
    fs.writeFileSync(p, "content");
    const stat = statFile(p);
    expect(stat).not.toBeNull();
    expect(stat!.isFile()).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });
});
