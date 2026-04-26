/**
 * Set similarity metrics for keyword and domain comparison.
 *
 * Jaccard similarity coefficient: |A ∩ B| / |A ∪ B|. Returns 0 for empty sets.
 *
 * Port of: mcp_server/shared/similarity.py
 */

/**
 * Compute Jaccard similarity between two sets.
 * Returns a value in [0, 1]. Returns 0 for two empty sets.
 */
export function jaccardSimilarity(
  setA: ReadonlySet<string>,
  setB: ReadonlySet<string>,
): number {
  if (setA.size === 0 && setB.size === 0) {
    return 0.0;
  }
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0.0;
}
