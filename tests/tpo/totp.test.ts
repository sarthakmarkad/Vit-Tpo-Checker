import { describe, expect, it } from "vitest";
import { base32Decode, generateTotp } from "../../src/tpo/totp.js";

/**
 * RFC 6238 Appendix B vectors, 8-digit form; the 6-digit expectation is the
 * same truncated number modulo 10^6. Secret: ASCII "12345678901234567890".
 */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32Decode", () => {
  it("decodes the RFC 6238 test secret", () => {
    expect(base32Decode(RFC_SECRET).toString()).toBe("12345678901234567890");
  });

  it("tolerates lowercase, spaces and padding", () => {
    const spaced = RFC_SECRET.toLowerCase().replace(/(.{4})/g, "$1 ") + "=";
    expect(base32Decode(spaced)).toEqual(base32Decode(RFC_SECRET));
  });

  it("rejects garbage", () => {
    expect(() => base32Decode("0189!@#")).toThrow(/invalid base32 character/);
    expect(() => base32Decode("")).toThrow(/empty base32 secret/);
  });
});

describe("generateTotp (RFC 6238 vectors)", () => {
  it("matches TOTP-SHA1 8-digit vectors", () => {
    expect(generateTotp(RFC_SECRET, { digits: 8, timestampMs: 59_000 })).toBe("94287082");
    expect(generateTotp(RFC_SECRET, { digits: 8, timestampMs: 1_111_111_109_000 })).toBe("07081804");
    expect(generateTotp(RFC_SECRET, { digits: 8, timestampMs: 1_234_567_890_000 })).toBe("89005924");
    expect(generateTotp(RFC_SECRET, { digits: 8, timestampMs: 2_000_000_000_000 })).toBe("69279037");
    expect(generateTotp(RFC_SECRET, { digits: 8, timestampMs: 20_000_000_000_000 })).toBe("65353130");
  });

  it("matches 6-digit codes (same truncated number, modulo 10^6)", () => {
    expect(generateTotp(RFC_SECRET, { timestampMs: 59_000 })).toBe("287082");
    expect(generateTotp(RFC_SECRET, { timestampMs: 1_111_111_109_000 })).toBe("081804");
    expect(generateTotp(RFC_SECRET, { timestampMs: 1_234_567_890_000 })).toBe("005924");
  });

  it("rejects out-of-range parameters", () => {
    expect(() => generateTotp(RFC_SECRET, { digits: 4 })).toThrow(/out of range/);
    expect(() => generateTotp(RFC_SECRET, { period: 0 })).toThrow(/out of range/);
  });
});
