import crypto from "node:crypto";

/**
 * RFC 6238 TOTP (time-based one-time password), sufficient for the Eduplus
 * MFA login: base32 secret, SHA-1 HMAC, 6 digits, 30-second window.
 * This is the identical algorithm Google Authenticator uses, so a code
 * generated here matches the one shown on the student's phone.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s-]/g, "").toUpperCase();
  if (clean.length === 0) {
    throw new Error("empty base32 secret");
  }
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    if (ch === "=") continue; // tolerate padded keys
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error(`invalid base32 character: ${ch}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export interface TotpOptions {
  digits?: number;
  period?: number;
  algorithm?: "SHA1" | "SHA256" | "SHA512";
  timestampMs?: number;
}

export function generateTotp(secret: string, options: TotpOptions = {}): string {
  const digits = Math.trunc(options.digits ?? 6);
  const period = Math.trunc(options.period ?? 30);
  const algorithm = options.algorithm ?? "SHA1";
  const nowMs = options.timestampMs ?? Date.now();
  if (digits < 6 || digits > 10 || period < 1) {
    throw new Error("TOTP parameters out of range (digits 6-10, period >= 1)");
  }

  const counter = Math.floor(nowMs / 1000 / period);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto
    .createHmac(algorithm === "SHA1" ? "sha1" : algorithm === "SHA256" ? "sha256" : "sha512", base32Decode(secret))
    .update(counterBuf)
    .digest();

  // RFC 4226 dynamic truncation.
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}
