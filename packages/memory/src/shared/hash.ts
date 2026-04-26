/**
 * Non-cryptographic DJB2 hash function for content fingerprinting.
 *
 * Generates fast, deterministic 32-bit fingerprints for text content.
 * Only the first 500 characters are hashed to bound computation time.
 *
 * Port of: mcp_server/shared/hash.py
 */

/**
 * Compute a 32-bit DJB2 hash of the first 500 characters of text.
 * Returns a lowercase hexadecimal string.
 */
export function simpleHash(text: string | null | undefined): string {
  const s = (text ?? "").slice(0, 500);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    // DJB2: h = ((h << 5) + h) + charCode  ≡  h * 33 + charCode
    h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}
