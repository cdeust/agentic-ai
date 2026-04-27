/**
 * @agentic/parity-runner — adversarial.ts
 *
 * Adversarial probe generator.
 *
 * Popperian rationale: the happy-path corpus confirms when it passes;
 * that confirmation is cheap. These adversarial probes are designed to
 * SEEK falsifications — each probe mutates one field at a time to a
 * boundary or pathological value. A divergence found by a probe is a
 * first-class finding, not a secondary concern.
 *
 * "A thousand observations consistent with a theory add less than one
 *  sincere failed attempt to refute it."
 * source: Popper (1963). Conjectures and Refutations, Ch. 1.
 *
 * Strategy: for each input fixture we generate 5 probes (one mutation
 * per probe) targeting the most semantically loaded fields.
 *
 * Probe mutation catalogue (5 per input — source: MASKING.md §2 field list):
 *   P1 — empty string in the primary text field (boundary: zero-length content)
 *   P2 — unicode stress string (multi-script, RTL, emoji) in the primary text field
 *   P3 — null for an optional field (boundary: null vs absent)
 *   P4 — deeply nested object replacing a string field (type boundary)
 *   P5 — oversized payload: primary text field set to 64 KiB of 'a' characters
 *         source: 64 KiB = 65536 bytes — common internal buffer boundary
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of adversarial probes generated per input fixture. */
export const PROBES_PER_FIXTURE = 5; // source: mission brief §4 — "5 adversarial inputs per source"

/** Size of oversized payload in bytes.
 *  source: 65536 = 2^16, a common I/O buffer boundary in POSIX systems.
 *  ref: Stevens & Rago (2013). "Advanced Programming in the UNIX Environment", §3.9.
 */
const OVERSIZED_PAYLOAD_BYTES = 65536;

/** Unicode stress string: Latin, Arabic (RTL), CJK, emoji, zero-width joiner.
 *  source: Unicode Standard §2.2 "Unicode Design Principles — Universal".
 *  Chosen to trigger: UTF-8 multi-byte paths, RTL bidi algorithm, emoji
 *  grapheme cluster splitting, zero-width joiners that can confuse tokenizers.
 */
const UNICODE_STRESS =
  "Hello مرحبا 世界 \u{1F600}‍\u{1F4BB} café";

/** Deeply nested sentinel object — replaces a string field to test type guards. */
const DEEP_OBJECT: Record<string, unknown> = {
  level1: { level2: { level3: { level4: { level5: "deep" } } } },
};

// ── Probe generator ───────────────────────────────────────────────────────────

export interface AdversarialProbe {
  /** Name of the original fixture this probe was derived from. */
  readonly originFixture: string;
  /** Probe index (1–5). */
  readonly probeIndex: number;
  /** Human label for the mutation kind. */
  readonly mutationLabel: string;
  /** The mutated input object. */
  readonly input: Record<string, unknown>;
}

/**
 * Identify the "primary text field" of an input — the field most likely
 * to carry semantic content that both implementations must handle identically.
 *
 * Priority: query > content > description > feature_description > text > message
 * source: parity-oracle/cortex/inputs/* and parity-oracle/prd/inputs/* field survey.
 */
function primaryTextField(input: Record<string, unknown>): string | null {
  const candidates = [
    "query",
    "content",
    "description",
    "feature_description",
    "text",
    "message",
  ];
  for (const key of candidates) {
    if (typeof input[key] === "string") return key;
  }
  return null;
}

/**
 * Identify an optional field (one that could plausibly be null/absent).
 * Candidates: tags, limit, domain, source, codebase_path.
 */
function optionalField(input: Record<string, unknown>): string | null {
  const candidates = ["tags", "limit", "domain", "source", "codebase_path"];
  for (const key of candidates) {
    if (key in input) return key;
  }
  return null;
}

/**
 * Generate PROBES_PER_FIXTURE adversarial probes from a single input fixture.
 *
 * Returns exactly PROBES_PER_FIXTURE probes. If the input lacks a primary text
 * field for some mutations, those mutations fall back to inserting a synthetic
 * field named "_probe_synthetic" — ensuring the probe count is always exactly 5.
 */
export function generateProbes(
  fixtureName: string,
  input: Record<string, unknown>,
): readonly AdversarialProbe[] {
  const primaryKey = primaryTextField(input) ?? "_probe_synthetic";
  const optKey = optionalField(input) ?? "limit";

  const probes: AdversarialProbe[] = [
    // P1: empty string in the primary text field.
    {
      originFixture: fixtureName,
      probeIndex: 1,
      mutationLabel: "empty_primary_field",
      input: { ...input, [primaryKey]: "" },
    },
    // P2: unicode stress string.
    {
      originFixture: fixtureName,
      probeIndex: 2,
      mutationLabel: "unicode_stress_primary_field",
      input: { ...input, [primaryKey]: UNICODE_STRESS },
    },
    // P3: null for optional field.
    {
      originFixture: fixtureName,
      probeIndex: 3,
      mutationLabel: "null_optional_field",
      input: { ...input, [optKey]: null },
    },
    // P4: deep object replacing primary text field.
    {
      originFixture: fixtureName,
      probeIndex: 4,
      mutationLabel: "deep_object_primary_field",
      input: { ...input, [primaryKey]: DEEP_OBJECT },
    },
    // P5: oversized payload in primary text field.
    {
      originFixture: fixtureName,
      probeIndex: 5,
      mutationLabel: "oversized_payload_primary_field",
      input: {
        ...input,
        [primaryKey]: "a".repeat(OVERSIZED_PAYLOAD_BYTES),
      },
    },
  ];

  return probes;
}
