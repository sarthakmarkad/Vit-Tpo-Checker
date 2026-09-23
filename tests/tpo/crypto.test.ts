import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { decryptEpsValue, encryptPayload } from "../../src/tpo/crypto.js";
import { signRequestPayload, loadOrCreateDeviceKey } from "../../src/tpo/device.js";

describe("tpo client crypto", () => {
  it("decrypts real EPS header values captured from the browser", () => {
    // Real values from an authenticated browser session (structure check —
    // they decrypt to quoted JSON strings under the platform's static key).
    expect(decryptEpsValue("L8ciFHeNvMlW5EQ/GjaBBnz/A/eeEbaOmXop2nG94FQ=")).toBe(
      "12400000@vit.edu",
    );
    expect(decryptEpsValue("sezEpFCssBXggUvyxaOdNw==")).toBe("tpovi");
  });

  it("round-trips arbitrary payloads", () => {
    const original = { uid: "12400000@vit.edu", pass: "p@ss", publicKey: "abc==" };
    const cipher = encryptPayload(original);
    expect(decryptEpsValue(cipher)).toEqual(original);
  });

  it("encrypts a plain string the same way the SPA stores EPS values", () => {
    // encrypt("tpovi") must equal the known EPS-tenant ciphertext
    expect(encryptPayload("tpovi")).toBe("sezEpFCssBXggUvyxaOdNw==");
  });

  it("signs METHOD:PATH:TIMESTAMP like the SPA and verifies against the SPKI key", async () => {
    const key = await loadOrCreateDeviceKey();
    const ts = "1790140884202";
    const sig = signRequestPayload(key, "get", "/login/slidebardashboardnew", ts);
    const pub = crypto.createPublicKey({
      key: Buffer.from(key.publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    const ok = crypto.verify(
      "sha256",
      Buffer.from("GET:/login/slidebardashboardnew:1790140884202"),
      { key: pub, dsaEncoding: "ieee-p1363" },
      Buffer.from(sig, "base64"),
    );
    expect(ok).toBe(true);
  });
});
