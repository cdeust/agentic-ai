/**
 * Tests for shared/project-ids.ts — path/ID conversion.
 *
 * source: cortex@4260a99 tests_py/shared/test_project_ids.py (issue #18 fix)
 * source: cortex@4260a99 mcp_server/shared/project_ids.py (port)
 *
 * Covers POSIX, Windows (forward-slash + backslash), Git-Bash drive translation,
 * idempotence on existing on-disk slugs, and dotted-segment normalization.
 */

import { describe, expect, it } from "vitest";
import {
  cwdToProjectId,
  domainIdFromLabel,
  projectIdToLabel,
} from "../../src/shared/project-ids.js";

describe("cwdToProjectId — POSIX paths", () => {
  it("converts a normal POSIX path", () => {
    expect(cwdToProjectId("/Users/dev/cortex")).toBe("-Users-dev-cortex");
  });

  it("replaces all slashes with dashes", () => {
    expect(cwdToProjectId("/Users/dev/Developments/my-project")).toBe(
      "-Users-dev-Developments-my-project",
    );
  });

  it("returns null for null input", () => {
    expect(cwdToProjectId(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(cwdToProjectId(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(cwdToProjectId("")).toBeNull();
  });
});

describe("cwdToProjectId — Windows / Git-Bash forms (cortex issue #18)", () => {
  it("normalizes Windows forward-slash to lowercase slug", () => {
    // PSGSupport reporter data: 'C:/Users/michael.crawford' must produce
    // the same slug as the on-disk domain c--users-michael-crawford.
    expect(cwdToProjectId("C:/Users/michael.crawford")).toBe(
      "c--users-michael-crawford",
    );
  });

  it("normalizes Windows backslash to lowercase slug", () => {
    expect(cwdToProjectId("C:\\Users\\michael.crawford")).toBe(
      "c--users-michael-crawford",
    );
  });

  it("translates Git-Bash drive form to the same slug as the Windows form", () => {
    // Git-Bash represents 'C:/...' as '/c/...'. Same logical path → same slug.
    expect(cwdToProjectId("/c/users/michael.crawford")).toBe(
      "c--users-michael-crawford",
    );
  });

  it("handles bare drive letters (forward-slash and backslash)", () => {
    expect(cwdToProjectId("C:/")).toBe("c--");
    expect(cwdToProjectId("C:\\")).toBe("c--");
  });

  it("is case-insensitive on the drive letter", () => {
    expect(cwdToProjectId("c:/Users/foo")).toBe(cwdToProjectId("C:/Users/foo"));
  });

  it("collapses dotted filename segments to dashes (Windows path)", () => {
    // Dots are non-alnum and must collapse to '-' on Windows paths,
    // matching the Claude Code on-disk convention.
    expect(cwdToProjectId("C:/Users/michael.crawford/Project.Name")).toBe(
      "c--users-michael-crawford-project-name",
    );
  });
});

describe("cwdToProjectId — idempotence on existing slugs", () => {
  it("is idempotent on an existing POSIX-style slug", () => {
    // Round-trip: existing slugs in profiles.json must survive a re-pass.
    const slug = "-Users-cdeust-Developments-Cortex";
    expect(cwdToProjectId(slug)).toBe(slug);
  });

  it("is idempotent on an existing Windows-style slug", () => {
    const slug = "c--users-michael-crawford";
    expect(cwdToProjectId(slug)).toBe(slug);
  });
});

describe("projectIdToLabel", () => {
  it("strips the Users prefix", () => {
    expect(projectIdToLabel("-Users-dev-Developments-cortex")).toBe("cortex");
  });

  it("strips the Documents prefix", () => {
    expect(projectIdToLabel("-Users-dev-Documents-myproject")).toBe(
      "myproject",
    );
  });

  it("returns 'Unknown' for null", () => {
    expect(projectIdToLabel(null)).toBe("Unknown");
  });

  it("returns 'Unknown' for empty string", () => {
    expect(projectIdToLabel("")).toBe("Unknown");
  });

  it("replaces dashes with spaces", () => {
    expect(projectIdToLabel("-Users-dev-Developments-my-project")).toBe(
      "my project",
    );
  });
});

describe("domainIdFromLabel", () => {
  it("lowercases the label", () => {
    expect(domainIdFromLabel("MyProject")).toBe("myproject");
  });

  it("replaces non-alphanumeric runs with single dashes", () => {
    expect(domainIdFromLabel("My Project Name")).toBe("my-project-name");
  });
});
