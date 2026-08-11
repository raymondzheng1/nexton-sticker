import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  generateCapabilityCode,
  isValidCapabilityCode,
  newId,
  normalizeCapabilityCode,
} from "../../src/store/index";
import { installSeams, teardownSeams } from "./_fixtures";

describe("ids + capability codes (Harness §18)", () => {
  beforeEach(installSeams);
  afterEach(teardownSeams);

  it("newId uses the injected generator in tests (deterministic)", () => {
    expect(newId()).toBe("id-1");
    expect(newId()).toBe("id-2");
  });

  it("generates a canonical XXX-XXX code from the safe alphabet", () => {
    // injected counter RNG → deterministic, exercises formatting + alphabet indexing
    let i = 0;
    const code = generateCapabilityCode(() => i++ % CODE_ALPHABET.length);
    expect(code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    expect(isValidCapabilityCode(code)).toBe(true);
  });

  it("alphabet excludes the ambiguous I, L, O, 0, 1 and has 31 chars", () => {
    expect(CODE_ALPHABET).toHaveLength(31);
    for (const ch of ["I", "L", "O", "0", "1"]) expect(CODE_ALPHABET).not.toContain(ch);
  });

  it("normalises messy user input to the canonical form", () => {
    expect(normalizeCapabilityCode("abc def")).toBe("ABC-DEF");
    expect(normalizeCapabilityCode("a b c d e f")).toBe("ABC-DEF");
    expect(normalizeCapabilityCode("ABC-DEF")).toBe("ABC-DEF");
  });

  it("rejects invalid codes loudly (null, not a silent guess)", () => {
    expect(normalizeCapabilityCode("toolong123")).toBeNull(); // wrong length
    expect(normalizeCapabilityCode("AB")).toBeNull();
    expect(isValidCapabilityCode("abc-def")).toBe(false); // lower-case not canonical
    expect(isValidCapabilityCode("ABCDEF")).toBe(false); // missing hyphen
  });
});

describe("real Web Crypto defaults (no injected seams)", () => {
  // These run without installSeams(), exercising the production crypto-backed paths.
  it("generateCapabilityCode() with the real RNG yields a valid, well-formed code", () => {
    for (let i = 0; i < 25; i++) expect(isValidCapabilityCode(generateCapabilityCode())).toBe(true);
  });

  it("newId() with the real generator yields distinct, non-empty ids", () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
