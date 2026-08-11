/**
 * ID generation (Harness §1.1 multi-user readiness) + capability codes (Harness §18).
 *
 * - `newId()` mints globally-unique UUIDs so records created offline on different devices never
 *   collide when synced. Behind a seam so tests are deterministic.
 * - Capability codes are the no-account identity (§18.2): a short, friendly, unambiguous code over
 *   a 31-char alphabet (no I L O 0 1) that the manager carries between devices.
 *
 * Runtime-agnostic: uses Web Crypto (available in modern Node and browsers) via a narrow accessor,
 * so the same module works in tests, the eventual Next.js server, and the browser.
 */

interface CryptoLike {
  randomUUID(): string;
  getRandomValues<T extends Uint8Array>(array: T): T;
}

function webCrypto(): CryptoLike {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c || typeof c.randomUUID !== "function") {
    throw new Error("Web Crypto API unavailable in this runtime");
  }
  return c;
}

let idFn: () => string = () => webCrypto().randomUUID();

/** A globally-unique id (UUID by default). */
export function newId(): string {
  return idFn();
}

/** Test-only: deterministic ids (pass null to restore real UUIDs). */
export function __setIdGeneratorForTests(fn: (() => string) | null): void {
  idFn = fn ?? (() => webCrypto().randomUUID());
}

// ── Capability codes (§18.2) ────────────────────────────────────────────────

/** 31-char alphabet: A–Z and 2–9, minus the ambiguous I, L, O, 0, 1. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_GROUP = 3; // XXX-XXX
const CODE_GROUPS = 2;
const CODE_LEN = CODE_GROUP * CODE_GROUPS;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_GROUP}}-[${CODE_ALPHABET}]{${CODE_GROUP}}$`);

/** Uniform index in [0, max) via rejection sampling (no modulo bias). */
function defaultRandomInt(maxExclusive: number): number {
  const c = webCrypto();
  const limit = 256 - (256 % maxExclusive);
  const buf = new Uint8Array(1);
  // No initialiser: the do-while always assigns before the first read (pinned by eslint's
  // no-useless-assignment, which flagged the dead `= 0`).
  let x: number;
  do {
    c.getRandomValues(buf);
    x = buf[0] ?? 0;
  } while (x >= limit);
  return x % maxExclusive;
}

/**
 * Mint a friendly capability code like `LION-7FK` → formatted `LIO-N7F`… actually grouped as
 * `XXX-XXX`. Accepts an injectable `randomInt` for deterministic tests.
 */
export function generateCapabilityCode(
  randomInt: (maxExclusive: number) => number = defaultRandomInt,
): string {
  let raw = "";
  for (let i = 0; i < CODE_LEN; i++) {
    raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)] ?? "A";
  }
  return `${raw.slice(0, CODE_GROUP)}-${raw.slice(CODE_GROUP)}`;
}

/** True when a string is a well-formed canonical capability code (`XXX-XXX`). */
export function isValidCapabilityCode(code: string): boolean {
  return CODE_RE.test(code);
}

/**
 * Normalise user-typed input to the canonical `XXX-XXX` form: upper-case, strip anything not in the
 * alphabet, then re-group. Returns null when the result isn't a valid 6-char code (loud, not silent).
 */
export function normalizeCapabilityCode(input: string): string | null {
  const cleaned = [...input.toUpperCase()].filter((ch) => CODE_ALPHABET.includes(ch)).join("");
  if (cleaned.length !== CODE_LEN) return null;
  const code = `${cleaned.slice(0, CODE_GROUP)}-${cleaned.slice(CODE_GROUP)}`;
  return isValidCapabilityCode(code) ? code : null;
}
