/**
 * Tests for emotional-tagging.ts
 *
 * Verifies: emotion detection; arousal computation; valence computation;
 * importance boost (Yerkes-Dodson); decay resistance; full pipeline.
 */

import { describe, it, expect } from "vitest";
import {
  detectEmotions,
  computeArousal,
  computeEmotionalValence,
  tagMemoryEmotions,
} from "../../src/remember/emotional-tagging.js";

describe("detectEmotions", () => {
  it("returns all five emotions with values in [0, 1]", () => {
    const emotions = detectEmotions("fixed the error and it's working great!");
    expect(emotions.frustration).toBeGreaterThanOrEqual(0);
    expect(emotions.satisfaction).toBeGreaterThanOrEqual(0);
    expect(emotions.confusion).toBeGreaterThanOrEqual(0);
    expect(emotions.urgency).toBeGreaterThanOrEqual(0);
    expect(emotions.discovery).toBeGreaterThanOrEqual(0);
    expect(Object.values(emotions).every((v) => v <= 1.0)).toBe(true);
  });

  it("detects frustration for error-domain content", () => {
    const emotions = detectEmotions("error: the bug is still broken and keeps failing");
    expect(emotions.frustration).toBeGreaterThan(0);
  });

  it("detects satisfaction for success-domain content", () => {
    const emotions = detectEmotions("fixed and resolved — working perfectly now");
    expect(emotions.satisfaction).toBeGreaterThan(0);
  });

  it("detects urgency for critical content", () => {
    const emotions = detectEmotions("URGENT: production outage blocking deployment");
    expect(emotions.urgency).toBeGreaterThan(0);
  });

  it("detects discovery for insight content", () => {
    const emotions = detectEmotions("I just realized a key insight: TIL this approach works");
    expect(emotions.discovery).toBeGreaterThan(0);
  });

  it("returns zero emotions for neutral content", () => {
    const emotions = detectEmotions("The meeting is scheduled for Tuesday.");
    const sum = Object.values(emotions).reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThan(0.1);
  });
});

describe("computeArousal", () => {
  it("returns 0 for all-zero emotions", () => {
    expect(computeArousal({ frustration: 0, satisfaction: 0, confusion: 0, urgency: 0, discovery: 0 })).toBe(0.0);
  });

  it("returns value in [0, 1]", () => {
    const arousal = computeArousal({ frustration: 0.8, satisfaction: 0.5, confusion: 0.3, urgency: 0.6, discovery: 0.2 });
    expect(arousal).toBeGreaterThanOrEqual(0.0);
    expect(arousal).toBeLessThanOrEqual(1.0);
  });
});

describe("computeEmotionalValence", () => {
  it("positive emotions produce positive valence", () => {
    const v = computeEmotionalValence({ frustration: 0, satisfaction: 0.8, confusion: 0, urgency: 0, discovery: 0.6 });
    expect(v).toBeGreaterThan(0);
  });

  it("negative emotions produce negative valence", () => {
    const v = computeEmotionalValence({ frustration: 0.8, satisfaction: 0, confusion: 0, urgency: 0.6, discovery: 0 });
    expect(v).toBeLessThan(0);
  });

  it("returns value in [-1, 1]", () => {
    const v = computeEmotionalValence({ frustration: 1, satisfaction: 1, confusion: 1, urgency: 1, discovery: 1 });
    expect(v).toBeGreaterThanOrEqual(-1);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe("tagMemoryEmotions", () => {
  it("returns complete result with all fields", () => {
    const result = tagMemoryEmotions("fixed the critical production bug — feels great!");
    expect(result.emotions).toBeDefined();
    expect(result.arousal).toBeDefined();
    expect(result.valence).toBeDefined();
    expect(result.importance_boost).toBeGreaterThanOrEqual(1.0);
    expect(result.decay_resistance).toBeGreaterThanOrEqual(1.0);
    expect(typeof result.is_emotional).toBe("boolean");
    expect(typeof result.dominant_emotion).toBe("string");
  });

  it("neutral content returns is_emotional = false", () => {
    const result = tagMemoryEmotions("The project meeting was on Monday.");
    expect(result.is_emotional).toBe(false);
    expect(result.dominant_emotion).toBe("neutral");
  });
});
