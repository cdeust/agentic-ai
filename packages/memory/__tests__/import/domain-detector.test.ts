/**
 * Unit tests for domain-detector.ts
 *
 * source: mcp_server/handlers/import_sessions.py::_detect_domain_from_path
 */

import { describe, it, expect } from "vitest";
import { detectDomainFromPath } from "../../src/import/domain-detector.js";

describe("detectDomainFromPath", () => {
  it("returns 'unknown' for empty string", () => {
    // source: if not cwd: return "unknown" — import_sessions.py
    expect(detectDomainFromPath("")).toBe("unknown");
  });

  it("extracts domain after 'Developments'", () => {
    // source: container set includes "developments"
    expect(detectDomainFromPath("/Users/alice/Developments/cortex")).toBe("cortex");
  });

  it("extracts domain after 'projects'", () => {
    expect(detectDomainFromPath("/Users/bob/projects/my-app")).toBe("my-app");
  });

  it("extracts domain after 'repos'", () => {
    expect(detectDomainFromPath("/Users/bob/repos/agentic-ai/packages")).toBe("agentic-ai");
  });

  it("extracts domain after 'src'", () => {
    expect(detectDomainFromPath("/workspace/src/backend-service")).toBe("backend-service");
  });

  it("extracts domain after 'code'", () => {
    expect(detectDomainFromPath("/home/dev/code/prd-spec")).toBe("prd-spec");
  });

  it("falls back to last path component when no container found", () => {
    // source: return parts[-1].lower() if parts else "unknown"
    expect(detectDomainFromPath("/tmp/some-dir")).toBe("some-dir");
  });

  it("lowercases the result", () => {
    expect(detectDomainFromPath("/Users/alice/Developments/CORTEX")).toBe("cortex");
  });

  it("matches example from import_sessions: cdeust-style path", () => {
    expect(
      detectDomainFromPath("/Users/cdeust/Developments/agentic-ai"),
    ).toBe("agentic-ai");
  });

  it("returns 'unknown' for single component path", () => {
    // No container found, falls back to last part = "/"  edge case
    // '/' splits to empty parts → "unknown"
    expect(detectDomainFromPath("/")).toBe("unknown");
  });
});
