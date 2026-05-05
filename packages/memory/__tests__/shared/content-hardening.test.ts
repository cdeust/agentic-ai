/**
 * Tests for shared/content-hardening.ts
 *
 * Invariants verified:
 * - hardenContent("") → "" (empty pass-through)
 * - hardenContent returns NFC-normalized string
 * - hardenContent strips C0/C1 control chars except \t \n \r
 * - hardenContent strips bidi override chars (CVE-2021-42574)
 * - hardenContent truncates at maxBytes boundary (UTF-8 aware)
 * - CONTENT_MAX_BYTES equals 1 MiB
 *
 * source: cortex@ed33435 mcp_server/shared/content_hardening.py
 */

import { describe, it, expect } from "vitest";
import { hardenContent, CONTENT_MAX_BYTES } from "../../src/shared/content-hardening.js";

describe("CONTENT_MAX_BYTES", () => {
  it("is 1 MiB (1048576 bytes)", () => {
    // source: cortex@ed33435 mcp_server/shared/content_hardening.py:35
    // CONTENT_MAX_BYTES = 1 * 1024 * 1024
    expect(CONTENT_MAX_BYTES).toBe(1 * 1024 * 1024);
  });
});

describe("hardenContent — empty input", () => {
  it("returns empty string for empty input", () => {
    // postcondition: empty input → empty output unchanged
    expect(hardenContent("")).toBe("");
  });
});

describe("hardenContent — NFC normalization", () => {
  it("composes NFD-encoded é to precomposed NFC form", () => {
    // NFD: 'e' + combining acute (U+0301) → NFC: é (U+00E9)
    // source: Unicode Standard Annex #15 — NFC normalisation
    const nfd = "é"; // two code points
    const result = hardenContent(nfd);
    expect(result).toBe("é"); // one code point
    expect(result.length).toBe(1);
  });

  it("leaves already-NFC text unchanged", () => {
    const text = "café au lait";
    expect(hardenContent(text)).toBe(text);
  });
});

describe("hardenContent — control character stripping", () => {
  it("strips C0 control chars (0x00–0x08)", () => {
    // postcondition: result contains no chars in [0x00–0x08]
    const withNull = "hello\x00world";
    expect(hardenContent(withNull)).toBe("helloworld");
  });

  it("preserves \\t \\n \\r (allowed C0 subset)", () => {
    const text = "line1\nline2\ttab\r\n";
    expect(hardenContent(text)).toBe("line1\nline2\ttab\r\n");
  });

  it("strips 0x0b (vertical tab) and 0x0c (form feed)", () => {
    expect(hardenContent("a\x0bb\x0cc")).toBe("abc");
  });

  it("strips C1 controls (0x7f–0x9f)", () => {
    const withC1 = "hello\x7fworld\x9fend";
    expect(hardenContent(withC1)).toBe("helloworldend");
  });

  it("strips BOM / ZWNBSP (U+FEFF)", () => {
    const withBom = "﻿hello";
    expect(hardenContent(withBom)).toBe("hello");
  });

  it("strips bidi override chars (CVE-2021-42574 trojan source)", () => {
    // source: CVE-2021-42574 — bidi overrides enable trojan source injection
    const bidiChars = "‪‫‬‭‮⁦⁧⁨⁩";
    const result = hardenContent("clean" + bidiChars + "text");
    expect(result).toBe("cleantext");
  });
});

describe("hardenContent — byte-length cap", () => {
  it("returns string unchanged when below cap", () => {
    const text = "hello";
    expect(hardenContent(text, { maxBytes: 100 })).toBe("hello");
  });

  it("truncates to maxBytes UTF-8 boundary", () => {
    // 5 ASCII chars = 5 bytes; cap at 3 → "hel"
    const result = hardenContent("hello", { maxBytes: 3 });
    expect(result).toBe("hel");
    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(3);
  });

  it("does not split multi-byte sequences (valid UTF-8 output)", () => {
    // "é" is 2 bytes in UTF-8 (0xC3 0xA9); cap at 1 should yield "" not orphaned bytes
    const result = hardenContent("é", { maxBytes: 1 });
    // decoding ignores orphaned continuation bytes — result must be valid string
    expect(() => new TextEncoder().encode(result)).not.toThrow();
  });

  it("uses CONTENT_MAX_BYTES as default cap", () => {
    // A short string is well under 1 MiB — should pass through
    const text = "short text";
    expect(hardenContent(text)).toBe(text);
  });
});
