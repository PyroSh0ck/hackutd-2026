/**
 * Pure, dependency-free 64-bit FNV-1a over UTF-16 code units, as 16 hex characters. Used for stable,
 * server-derived identifiers (candidate ids) in code that must also run inside the SpacetimeDB module,
 * where `node:crypto` is unavailable. Not a security primitive.
 */
const OFFSET = BigInt("0xcbf29ce484222325");
const PRIME = BigInt("0x100000001b3");
const MASK = BigInt("0xffffffffffffffff");

export function stableHash64(input: string): string {
  let h = OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * PRIME) & MASK;
  }
  return h.toString(16).padStart(16, "0");
}
