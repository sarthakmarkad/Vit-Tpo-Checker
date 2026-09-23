import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Device key management — mirrors the SPA's IndexedDB-stored ECDSA P-256 key.
 * Our client generates its OWN keypair and registers it at login, exactly like
 * a second browser would. The private key stays on disk under gitignored var/.
 */

const DEVICE_FILE = join("var", "tpo-device.json");

export interface DeviceKey {
  /** base64 SPKI (public, sent to the server at login) */
  publicKeyB64: string;
  /** base64 PKCS8 (private, used to sign requests locally) */
  privateKeyB64: string;
}

export async function loadOrCreateDeviceKey(): Promise<DeviceKey> {
  try {
    const raw = JSON.parse(await readFile(DEVICE_FILE, "utf8")) as DeviceKey;
    if (raw.publicKeyB64 && raw.privateKeyB64) return raw;
  } catch {
    // fall through to generation
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const key: DeviceKey = {
    publicKeyB64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKeyB64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
  await mkdir(join("var"), { recursive: true });
  await writeFile(DEVICE_FILE, JSON.stringify(key, null, 2), { mode: 0o600 });
  return key;
}

/**
 * Sign "METHOD:PATH:TIMESTAMP" exactly like the SPA:
 * WebCrypto ECDSA P-256 with SHA-256 digest → base64 (DER signature).
 */
export function signRequestPayload(
  key: DeviceKey,
  method: string,
  pathname: string,
  timestampMs: string,
): string {
  const payload = `${method.toUpperCase()}:${pathname}:${timestampMs}`;
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(key.privateKeyB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const signature = crypto.sign("sha256", Buffer.from(payload, "utf8"), {
    key: privateKey,
    // WebCrypto emits raw r||s (IEEE P1363) — the server expects that format.
    dsaEncoding: "ieee-p1363",
  });
  return signature.toString("base64");
}
