import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnv } from "../config/env.js";
import { logger } from "../logger.js";
import { solveAltcha } from "./altcha.js";
import { encryptPayload } from "./crypto.js";
import { loadOrCreateDeviceKey, signRequestPayload } from "./device.js";
import { updateJar, type CookieJar } from "./cookies.js";
import { auditLiveRequest } from "./audit.js";
import { buildOrderedHeaders } from "./headers.js";
import { TpoApiError } from "./errors.js";

/**
 * First-party login flow — byte-compatible with the SPA's login page:
 *   1. ensure our ECDSA P-256 device key
 *   2. solve the ALTCHA proof-of-work (as designed, no bypass)
 *   3. encrypt {uid, pass, publicKey, altcha} with the platform's client key
 *   4. POST /login/process  {params: <ciphertext>}  (signed, like the browser)
 *   5. store the EPS-uid / EPS-tenant header values in gitignored var/
 *
 * NOTE: like any second browser login, this may re-bind the active device key
 * for the account — the user's browser session may need to log in again.
 */

const SESSION_FILE = join("var", "tpo-session.json");

export interface StoredSession {
  /** AES-encrypted values, exactly as the SPA stores in localStorage */
  epsUid: string;
  epsTenant: string;
  epsUsertype: string;
  /** decrypted convenience copy (gitignored var/ only) */
  uid: string;
  tenant: string;
  usertype: string;
  /** auth cookies from the login response (EPS_TOKEN / EPS_REFRESH_TOKEN) */
  cookies: CookieJar;
  loggedInAt: string;
}

const LOGIN_ROUTER_PATH = "/";

interface LoginProcessResponse {
  msg: string;
  uid?: string;
  enc_uid?: string;
  tenant?: string;
  usertype?: string;
  policy_read?: boolean;
  is_management?: boolean;
}

export async function login(username: string, password: string): Promise<StoredSession> {
  const env = loadEnv();
  if (!env.ALLOW_LIVE_API) {
    throw new TpoApiError(
      "Live API disabled (ALLOW_LIVE_API=false). Login was not attempted.",
      "live_disabled",
    );
  }
  const log = logger.child({ module: "tpo-login" });

  log.info("ensuring device key");
  const deviceKey = await loadOrCreateDeviceKey();

  log.info("solving ALTCHA challenge");
  const altcha = await solveAltcha();

  const payload = {
    uid: username,
    pass: password,
    publicKey: deviceKey.publicKeyB64,
    altcha: altcha.payload,
  };
  const params = encryptPayload(payload);

  const path = "/login/process";
  const ts = Date.now().toString();
  const signature = signRequestPayload(deviceKey, "POST", path, ts);

  const headerPairs = buildOrderedHeaders({
    auth: {
      epsUid: "",
      epsTenant: "",
      deviceSignature: signature,
      requestTimestamp: ts,
      cookieHeader: null,
    },
    routerPath: LOGIN_ROUTER_PATH,
    hasBody: true,
  });
  const headers = Object.fromEntries(headerPairs);

  const res = await fetch(new URL(path, env.TPO_API_BASE_URL), {
    method: "POST",
    headers,
    body: JSON.stringify({ params }),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await res.text();
  let parsed: LoginProcessResponse;
  try {
    parsed = JSON.parse(text) as LoginProcessResponse;
  } catch {
    await auditLiveRequest({ method: "POST", path, status: res.status, ok: false, note: "non-json" });
    throw new TpoApiError(`login/process returned non-JSON (HTTP ${res.status})`, String(res.status));
  }
  await auditLiveRequest({
    method: "POST",
    path,
    status: res.status,
    ok: parsed.msg === "200",
    note: parsed.msg === "200" ? undefined : `business-${parsed.msg}`,
  });

  if (parsed.msg !== "200" || !parsed.uid || !parsed.tenant) {
    // Common failure codes: wrong password, altcha failure, domain mismatch.
    throw new TpoApiError(
      `login/process failed: msg=${parsed.msg} (HTTP ${res.status})`,
      parsed.msg ?? String(res.status),
    );
  }

  // Capture the auth cookies the browser would persist (EPS_TOKEN etc.).
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookies = updateJar({}, setCookies);
  if (!cookies["EPS_TOKEN"]) {
    throw new TpoApiError("login/process did not issue EPS_TOKEN cookie", "no_token");
  }

  const session: StoredSession = {
    epsUid: parsed.enc_uid ?? encryptPayload(parsed.uid),
    epsTenant: encryptPayload(parsed.tenant),
    epsUsertype: encryptPayload(parsed.usertype ?? ""),
    uid: parsed.uid,
    tenant: parsed.tenant,
    usertype: parsed.usertype ?? "",
    cookies,
    loggedInAt: new Date().toISOString(),
  };

  await mkdir(join("var"), { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
  log.info({ uid: session.uid, tenant: session.tenant }, "login complete ✓ — session stored");
  return session;
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  try {
    return JSON.parse(await readFile(SESSION_FILE, "utf8")) as StoredSession;
  } catch {
    return null;
  }
}
