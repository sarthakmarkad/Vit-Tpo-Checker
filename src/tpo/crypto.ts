import crypto from "node:crypto";

/**
 * Client-side payload encryption, byte-compatible with the TPO SPA's
 * CryptoJS.AES.encrypt(JSON.stringify(value), key, {ECB, Pkcs7}).
 *
 * The key is a public constant embedded in the platform's shipped JS
 * (module "0336" of app.js) — it protects nothing by itself; it exists so our
 * client can speak the same wire format the browser speaks. It is NOT a user
 * secret and must not be treated as one.
 */

const STATIC_KEY_B64 = "klKQSOngPDDh9deChl6l1q75fJzTnp+AHSUGorH4CBo=";
const KEY = Buffer.from(STATIC_KEY_B64, "base64");

export function encryptPayload(value: unknown): string {
  const json = JSON.stringify(value);
  const cipher = crypto.createCipheriv("aes-256-ecb", KEY, null);
  const out = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  return out.toString("base64");
}

export function decryptPayload(ciphertextB64: string): string {
  const decipher = crypto.createDecipheriv("aes-256-ecb", KEY, null);
  const out = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return out.toString("utf8");
}

/** Decrypt an EPS-* header/JSON value like '"12400000@vit.edu"' → raw string. */
export function decryptEpsValue(ciphertextB64: string): string {
  return JSON.parse(decryptPayload(ciphertextB64)) as string;
}
