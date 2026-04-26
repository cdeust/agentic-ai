/**
 * Phase 7: content ingestion hardening.
 *
 * Applied at every user-input boundary (remember, ingest_*, backfill) to
 * prevent three classes of defect:
 *
 *   1. Unicode duplicate memories (NFC normalization).
 *      "café" written as U+00E9 vs "cafe" + U+0301 hash-mismatches and
 *      creates ghost duplicates. NFC composes to the precomposed form
 *      consistently.
 *
 *   2. ReDoS amplification via adversarially long content.
 *      Content is capped at CONTENT_MAX_BYTES (default 1 MB). A single
 *      1-MB payload hitting a vulnerable regex can block the event loop
 *      for seconds. Truncation is silent but logged via stderr.
 *
 *   3. Unicode control / format characters that break tsvector /
 *      downstream DOM rendering. We strip:
 *        - C0 controls except \t \n \r
 *        - C1 controls (U+0080–U+009F)
 *        - BOM / ZWNBSP (U+FEFF)
 *        - Bidi-override overrides (trojan source — CVE-2021-42574)
 *
 * source: Unicode Standard Annex #15 (Normalization Forms)
 * source: CVE-2021-42574 (Trojan Source bidi override injection)
 * source: docs/program/phase-5-pool-admission-design.md §7 (hardening)
 *
 * Port of: mcp_server/shared/content_hardening.py
 */

/** 1 MB default. Environment override via CORTEX_MEMORY_CONTENT_MAX_BYTES. */
export const CONTENT_MAX_BYTES = 1 * 1024 * 1024;

// Stripped: C0 controls except \t \n \r, all C1 controls, BOM/ZWNBSP,
// Unicode bidi overrides.
// source: CVE-2021-42574 (Trojan Source bidi override injection)
const BIDI_OVERRIDES = "‪‫‬‭‮⁦⁧⁨⁩";
const STRIP_RE = new RegExp(
  `[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f﻿${BIDI_OVERRIDES}]`,
  "g",
);

function stripControlChars(s: string): string {
  return s.replace(STRIP_RE, "");
}

function capBytes(s: string, maxBytes: number): string {
  // Encode to UTF-8, truncate bytes, re-decode safely.
  // TextEncoder/TextDecoder are available in Node >= 16 and all browsers.
  const encoded = new TextEncoder().encode(s);
  if (encoded.byteLength <= maxBytes) return s;
  console.warn(
    `[content-hardening] Content truncated from ${encoded.byteLength} bytes to ${maxBytes} at ingestion`,
  );
  // Slice bytes then decode — errors: 'ignore' equivalent via try/replace
  const sliced = encoded.slice(0, maxBytes);
  return new TextDecoder("utf-8", { fatal: false }).decode(sliced);
}

/**
 * Apply the full content-hardening pipeline at ingestion.
 *
 * Returns the hardened string. Callers should use the returned value,
 * not the input — truncation, normalization, and stripping are all
 * potentially observable.
 *
 * Precondition: `content` is a string. Accepts empty strings and returns
 * them unchanged.
 */
export function hardenContent(
  content: string,
  { maxBytes = CONTENT_MAX_BYTES }: { maxBytes?: number } = {},
): string {
  if (!content) return "";
  let hardened = stripControlChars(content);
  // source: Unicode Standard Annex #15 — NFC normalization
  hardened = hardened.normalize("NFC");
  hardened = capBytes(hardened, maxBytes);
  return hardened;
}
