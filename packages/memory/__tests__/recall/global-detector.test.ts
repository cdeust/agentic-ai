/**
 * Tests for global-detector.ts
 *
 * Verifies: architecture signal detection; score threshold; project anchor penalty;
 * explicit global tag boost; tool log suppression.
 */

import { describe, it, expect } from "vitest";
import { detectGlobal, GLOBAL_THRESHOLD } from "../../src/recall/global-detector.js";

describe("detectGlobal", () => {
  it("returns false for empty content", () => {
    const [isGlobal] = detectGlobal("");
    expect(isGlobal).toBe(false);
  });

  it("returns false for tool log", () => {
    const [isGlobal] = detectGlobal("# Tool: Bash\nsome output");
    expect(isGlobal).toBe(false);
  });

  it("detects architecture signals", () => {
    const content =
      "We use clean architecture with dependency injection and single responsibility principle throughout all our projects.";
    const [isGlobal, score] = detectGlobal(content);
    expect(score).toBeGreaterThan(GLOBAL_THRESHOLD);
    expect(isGlobal).toBe(true);
  });

  it("returns not_global for project-specific content", () => {
    const content = "Fixed bug in src/handlers/billing/stripe.ts on branch feature/fix-123, PR #456 merged at commit abc1234";
    const [isGlobal] = detectGlobal(content);
    // Anchors should penalize the score heavily
    expect(isGlobal).toBe(false);
  });

  it("boosts for global tags", () => {
    const content = "database url for production";
    const [, scoreWithTags] = detectGlobal(content, ["global", "infrastructure"]);
    const [, scoreWithout] = detectGlobal(content, []);
    expect(scoreWithTags).toBeGreaterThan(scoreWithout);
  });

  it("returns reason with category prefix for global", () => {
    const content =
      "security policy: always use OAuth2 with PKCE. This applies across all projects.";
    const [isGlobal, , reason] = detectGlobal(content);
    if (isGlobal) {
      expect(reason).toMatch(/^global_/);
    }
  });

  it("returns not_global reason when below threshold", () => {
    const [, , reason] = detectGlobal("just a casual note about something");
    expect(reason).toBe("not_global");
  });

  it("invariant: is_global iff score >= GLOBAL_THRESHOLD", () => {
    const cases = [
      "clean architecture pattern",
      "database url for production",
      "just a random note",
      "security policy api key rotation team agreement",
    ];
    for (const c of cases) {
      const [isGlobal, score] = detectGlobal(c);
      expect(isGlobal).toBe(score >= GLOBAL_THRESHOLD);
    }
  });
});
