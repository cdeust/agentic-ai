/**
 * Unit tests for infrastructure/config.ts
 *
 * Invariant: all exported paths are absolute; each uses os.homedir() as root.
 *
 * source: Cortex mcp_server/infrastructure/config.py
 */

import { describe, it, expect } from "vitest";
import * as os from "os";
import * as path from "path";

import {
  CLAUDE_DIR,
  METHODOLOGY_DIR,
  PROFILES_PATH,
  SESSION_LOG_PATH,
  BRAIN_INDEX_PATH,
  MCP_CONNECTIONS_PATH,
  WIKI_ROOT,
} from "../../src/infrastructure/config.js";

describe("config", () => {
  it("CLAUDE_DIR is absolute and under home", () => {
    expect(path.isAbsolute(CLAUDE_DIR)).toBe(true);
    expect(CLAUDE_DIR).toBe(path.join(os.homedir(), ".claude"));
  });

  it("METHODOLOGY_DIR is child of CLAUDE_DIR", () => {
    expect(METHODOLOGY_DIR).toBe(path.join(CLAUDE_DIR, "methodology"));
  });

  it("PROFILES_PATH is under METHODOLOGY_DIR", () => {
    expect(PROFILES_PATH).toBe(path.join(METHODOLOGY_DIR, "profiles.json"));
  });

  it("SESSION_LOG_PATH is under METHODOLOGY_DIR", () => {
    expect(SESSION_LOG_PATH).toBe(path.join(METHODOLOGY_DIR, "session-log.json"));
  });

  it("BRAIN_INDEX_PATH is under CLAUDE_DIR", () => {
    expect(BRAIN_INDEX_PATH).toBe(path.join(CLAUDE_DIR, "brain-index.json"));
  });

  it("MCP_CONNECTIONS_PATH is under METHODOLOGY_DIR", () => {
    expect(MCP_CONNECTIONS_PATH).toBe(
      path.join(METHODOLOGY_DIR, "mcp-connections.json"),
    );
  });

  it("WIKI_ROOT is under METHODOLOGY_DIR", () => {
    expect(WIKI_ROOT).toBe(path.join(METHODOLOGY_DIR, "wiki"));
  });
});
