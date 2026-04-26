/**
 * Schema-validation tests for wiki templates.
 */

import { describe, it, expect } from "vitest";
import {
  TEMPLATES,
  REQUIRED_FRONTMATTER,
  templateFor,
  requiredFields,
  validStatusValues,
  namingConvention,
} from "../../src/wiki/templates.js";
import { PAGE_KINDS } from "../../src/wiki/layout.js";

describe("TEMPLATES", () => {
  it("has a template for every PAGE_KIND", () => {
    for (const kind of PAGE_KINDS) {
      expect(TEMPLATES[kind]).toBeTruthy();
    }
  });

  it("all templates contain a title placeholder", () => {
    for (const [kind, template] of Object.entries(TEMPLATES)) {
      if (kind === "files") continue; // files uses file_path not title
      expect(template).toContain("{{title}}");
    }
  });

  it("ADR template contains required structural sections", () => {
    const adr = TEMPLATES["adr"]!;
    expect(adr).toContain("## Context");
    expect(adr).toContain("## Decision");
    expect(adr).toContain("## Consequences");
  });

  it("lesson template contains postmortem sections", () => {
    const lesson = TEMPLATES["lessons"]!;
    expect(lesson).toContain("## What happened");
    expect(lesson).toContain("## Why it went wrong");
    expect(lesson).toContain("## Rule going forward");
  });
});

describe("templateFor", () => {
  it("returns template for known kind", () => {
    expect(templateFor("adr")).toBe(TEMPLATES["adr"]);
    expect(templateFor("notes")).toBe(TEMPLATES["notes"]);
  });

  it("returns null for unknown kind", () => {
    expect(templateFor("unknown-kind")).toBeNull();
  });
});

describe("requiredFields", () => {
  it("returns specific fields for known kinds", () => {
    const adrFields = requiredFields("adr");
    expect(adrFields).toContain("title");
    expect(adrFields).toContain("status");
    expect(adrFields).toContain("date");
  });

  it("returns fallback for unknown kind", () => {
    const fields = requiredFields("unknown");
    expect(fields).toContain("title");
    expect(fields).toContain("updated");
  });

  it("every PAGE_KIND has required fields", () => {
    for (const kind of PAGE_KINDS) {
      const fields = requiredFields(kind);
      expect(fields.length).toBeGreaterThan(0);
    }
  });
});

describe("REQUIRED_FRONTMATTER", () => {
  it("every defined kind requires at least a title", () => {
    for (const [kind, fields] of Object.entries(REQUIRED_FRONTMATTER)) {
      if (kind === "files") {
        expect(fields).toContain("file_path");
      } else {
        expect(fields).toContain("title");
      }
    }
  });
});

describe("validStatusValues", () => {
  it("ADR has correct statuses", () => {
    const statuses = validStatusValues("adr");
    expect(statuses).toContain("accepted");
    expect(statuses).toContain("proposed");
    expect(statuses).toContain("deprecated");
  });

  it("returns empty for kinds without status", () => {
    expect(validStatusValues("notes")).toHaveLength(0);
  });
});

describe("namingConvention", () => {
  it("ADR convention matches NNNN-slug pattern", () => {
    const { pattern } = namingConvention("adr");
    const re = new RegExp(pattern);
    expect(re.test("0001-use-pgvector")).toBe(true);
    expect(re.test("0042-prefer-plan-over-list")).toBe(true);
    expect(re.test("foo-bar")).toBe(false); // no leading digits
  });

  it("default convention rejects underscores", () => {
    const { pattern } = namingConvention("notes");
    const re = new RegExp(pattern);
    expect(re.test("my-note")).toBe(true);
    expect(re.test("my_note")).toBe(false);
  });
});
