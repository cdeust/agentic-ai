/**
 * Produces human-readable context paragraphs from structured profiles.
 *
 * Template-based text generation: iterate over profile sections and append
 * sentences. Deterministic, <200 words for system prompt budget.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/context_generator.py
 */

// ── Descriptor helpers ────────────────────────────────────────────────────

/**
 * Describe the top entry point pattern.
 * source: cortex@ed33435 mcp_server/core/context_generator.py:12-17
 */
function describeEntryPoints(profile: Record<string, unknown>): string | null {
  const entryPoints = (profile["entryPoints"] ?? []) as Array<Record<string, unknown>>;
  if (entryPoints.length === 0) return null;
  const first = entryPoints[0];
  if (!first) return null;
  return `You typically ${first["pattern"] ?? ""}.`;
}

/**
 * Describe up to two recurring patterns.
 * source: cortex@ed33435 mcp_server/core/context_generator.py:20-28
 */
function describeRecurringPatterns(profile: Record<string, unknown>): string | null {
  const recurring = (profile["recurringPatterns"] ?? []) as Array<Record<string, unknown>>;
  if (recurring.length === 0) return null;
  const patterns = recurring.slice(0, 2).map((p) => p["pattern"] ?? "");
  if (patterns.length === 1) return `You ${patterns[0]}.`;
  return `You ${patterns[0]}, and you ${patterns[1]}.`;
}

/**
 * Describe the top blind spot with optional suggestion.
 * source: cortex@ed33435 mcp_server/core/context_generator.py:31-41
 */
function describeBlindSpots(profile: Record<string, unknown>): string | null {
  const blindSpots = (profile["blindSpots"] ?? []) as Array<Record<string, unknown>>;
  if (blindSpots.length === 0) return null;
  const top = blindSpots[0];
  if (!top) return null;
  let text = `Blind spot: ${top["description"] ?? ""}.`;
  const suggestion = top["suggestion"];
  if (suggestion) text += ` ${suggestion}.`;
  return text;
}

/**
 * Describe the top cross-domain connection.
 * source: cortex@ed33435 mcp_server/core/context_generator.py:44-50
 */
function describeBridges(profile: Record<string, unknown>): string | null {
  const bridges = (profile["connectionBridges"] ?? []) as Array<Record<string, unknown>>;
  if (bridges.length === 0) return null;
  const top = bridges[0];
  if (!top) return null;
  return `You often connect this to ${top["toDomain"] ?? ""} (${top["pattern"] ?? ""}).`;
}

/**
 * Describe metacognitive style traits.
 * source: cortex@ed33435 mcp_server/core/context_generator.py:53-65
 */
function describeMetacognitive(profile: Record<string, unknown>): string | null {
  const mc = profile["metacognitive"] as Record<string, unknown> | undefined;
  if (!mc) return null;
  const styleParts: string[] = [];
  if (mc["explorationStyle"]) styleParts.push(mc["explorationStyle"] as string);
  if (mc["problemDecomposition"]) styleParts.push(mc["problemDecomposition"] as string);
  if (styleParts.length === 0) return null;
  return `You're a ${styleParts.join(", ")} thinker.`;
}

/**
 * Describe the dominant behavioral feature activation.
 * source: cortex@ed33435 mcp_server/core/context_generator.py:68-74
 */
function describeDominantFeature(profile: Record<string, unknown>): string | null {
  const activations = profile["featureActivations"] as Record<string, number> | undefined;
  if (!activations || Object.keys(activations).length === 0) return null;
  const maxLabel = Object.keys(activations).reduce((best, k) =>
    Math.abs(activations[k] ?? 0) > Math.abs(activations[best] ?? 0) ? k : best,
  );
  return `Your dominant behavioral mode is ${maxLabel}.`;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Generate a full context paragraph from a domain profile.
 *
 * precondition:  domain and profile may be null/undefined.
 * postcondition: returns a non-empty string always; returns the no-profile
 *   message when profile or domain is null.
 *
 * source: cortex@ed33435 mcp_server/core/context_generator.py:77-109
 */
export function generateContext(
  domain: string | null | undefined,
  profile: Record<string, unknown> | null | undefined,
): string {
  if (!profile || !domain) {
    return "No cognitive profile yet. Building one as we go.";
  }

  const parts: string[] = [
    `You're working in ${(profile["label"] as string | undefined) ?? domain}.`,
  ];

  const descriptors = [
    describeEntryPoints,
    describeRecurringPatterns,
    describeBlindSpots,
    describeBridges,
    describeMetacognitive,
  ];

  for (const descriptor of descriptors) {
    const text = descriptor(profile);
    if (text) parts.push(text);
  }

  const sessionShape = profile["sessionShape"] as Record<string, unknown> | undefined;
  if (sessionShape?.["dominantMode"]) {
    parts.push(`You prefer ${sessionShape["dominantMode"]} sessions.`);
  }

  const featureText = describeDominantFeature(profile);
  if (featureText) parts.push(featureText);

  const sessionCount = (profile["sessionCount"] as number | undefined) ?? 0;
  const confidence = (profile["confidence"] as number | undefined) ?? 0;
  parts.push(
    `Based on ${sessionCount} prior sessions with ${Math.round(confidence * 100)}% confidence.`,
  );

  return parts.join(" ");
}

/**
 * Generate a compact context label: 'domain · style · mode'.
 *
 * postcondition: returns null when profile or domain is null;
 *   otherwise returns a ' · '-joined string.
 *
 * source: cortex@ed33435 mcp_server/core/context_generator.py:112-133
 */
export function generateShortContext(
  domain: string | null | undefined,
  profile: Record<string, unknown> | null | undefined,
): string | null {
  if (!profile || !domain) return null;

  const parts: string[] = [];
  parts.push((profile["label"] as string | undefined) ?? domain);

  const mc = profile["metacognitive"] as Record<string, unknown> | undefined;
  if (mc) {
    if (mc["explorationStyle"]) parts.push(mc["explorationStyle"] as string);
    if (mc["problemDecomposition"]) parts.push(mc["problemDecomposition"] as string);
  }

  const sessionShape = profile["sessionShape"] as Record<string, unknown> | undefined;
  if (sessionShape?.["dominantMode"]) {
    parts.push(sessionShape["dominantMode"] as string);
  }

  return parts.join(" · ");
}
