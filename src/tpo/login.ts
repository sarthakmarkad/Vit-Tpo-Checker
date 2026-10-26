import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnv, type Env } from "../config/env.js";
import { logger } from "../logger.js";
import { solveAltcha } from "./altcha.js";
import { encryptPayload } from "./crypto.js";
import { loadOrCreateDeviceKey, signRequestPayload, type DeviceKey } from "./device.js";
import { updateJar, type CookieJar } from "./cookies.js";
import { auditLiveRequest } from "./audit.js";
import { buildOrderedHeaders } from "./headers.js";
import { TpoApiError } from "./errors.js";
import { generateTotp } from "./totp.js";

/**
 * First-party login flow — byte-compatible with the SPA's login page:
 *   1. ensure our ECDSA P-256 device key
 *   2. solve the ALTCHA proof-of-work (as designed, no bypass)
 *   3. encrypt {uid, pass, publicKey, altcha, ...} with the platform's client key
 *   4. POST /login/process  {params: <ciphertext>}  (signed, like the browser)
 *   5. when the portal enforces MFA (enable_mfa_based_login + mfa_verified=false),
 *      submit a second /login/process with value:"MFA", a fresh ALTCHA, and
 *      selected_otp = RFC 6238 TOTP generated from TPO_TOTP_SECRET — the same
 *      6 digits the authenticator shows
 *   6. store the EPS-uid / EPS-tenant header values in gitignored var/
 *
 * NOTE: like any second browser login, this may re-bind the active device key
 * for the account — the user's browser session may need to log in again.
 */

const SESSION_FILE = join("var", "tpo-session.json");
/** SPA-host constant included in every login submission by the browser. */
const LOGIN_DNS = "tpo.vierp.in";

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
  /** MFA fields — the portal rolled out TOTP-based two-factor login */
  enable_mfa_based_login?: boolean;
  mfa_secret?: boolean;
  mfa_verified?: boolean;
}

/** Wire-format fields, byte-identical to the SPA's login submission. */
interface LoginPayload {
  uid: string;
  pass: string;
  /** "" on the password step; "MFA" on the TOTP step */
  value: string;
  publicKey: string;
  device_configuration: "{}";
  altcha: string;
  /** "" on the password step; the 6-digit authenticator code on the TOTP step */
  selected_otp: string;
  dns: string;
}

/** True when the portal answered the password step with an MFA challenge. */
export function needsMfaSecondStep(response: LoginProcessResponse): boolean {
  return Boolean(response.enable_mfa_based_login) && response.mfa_verified !== true;
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

  const first = await postLoginProcess(env, deviceKey, {
    uid: username,
    pass: password,
    value: "",
    publicKey: deviceKey.publicKeyB64,
    device_configuration: "{}",
    altcha: altcha.payload,
    selected_otp: "",
    dns: LOGIN_DNS,
  });
  let finalRes = first.res;
  let response = first.response;

  // Portal MFA gate: the password alone no longer establishes a session.
  // Submit a second /login/process carrying the TOTP code (SPA step 2).
  if (needsMfaSecondStep(response)) {
    if (!env.TPO_TOTP_SECRET) {
      throw new TpoApiError(
        "Portal requires two-factor login (Eduplus TOTP). Add your authenticator " +
          "setup key to .env as TPO_TOTP_SECRET (Google Authenticator → the " +
          "EduplusJobs entry → setup key / copy token).",
        "mfa_required",
      );
    }
    log.info("portal requires MFA — submitting TOTP second factor");
    const altcha2 = await solveAltcha();
    const second = await postLoginProcess(env, deviceKey, {
      uid: username,
      pass: password,
      value: "MFA",
      publicKey: deviceKey.publicKeyB64,
      device_configuration: "{}",
      altcha: altcha2.payload,
      selected_otp: generateTotp(env.TPO_TOTP_SECRET),
      dns: LOGIN_DNS,
    });
    finalRes = second.res;
    response = second.response;
  }

  if (response.msg !== "200" || !response.uid || !response.tenant) {
    // Common failure codes: wrong password, bad TOTP, altcha failure, domain mismatch.
    throw new TpoApiError(
      `login/process failed: msg=${response.msg ?? "<none>"} (HTTP ${finalRes.status})`,
      response.msg ?? String(finalRes.status),
    );
  }

  // Capture the auth cookies the browser would persist (EPS_TOKEN etc.).
  const setCookies = finalRes.headers.getSetCookie?.() ?? [];
  const cookies = updateJar({}, setCookies);
  if (!cookies["EPS_TOKEN"]) {
    throw new TpoApiError("login/process did not issue EPS_TOKEN cookie", "no_token");
  }

  const session: StoredSession = {
    epsUid: response.enc_uid ?? encryptPayload(response.uid),
    epsTenant: encryptPayload(response.tenant),
    epsUsertype: encryptPayload(response.usertype ?? ""),
    uid: response.uid,
    tenant: response.tenant,
    usertype: response.usertype ?? "",
    cookies,
    loggedInAt: new Date().toISOString(),
  };

  await mkdir(join("var"), { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
  log.info({ uid: session.uid, tenant: session.tenant }, "login complete ✓ — session stored");
  return session;
}

async function postLoginProcess(
  env: Env,
  deviceKey: DeviceKey,
  payload: Omit<LoginPayload, "publicKey"> & { publicKey: string },
): Promise<{ res: Response; response: LoginProcessResponse }> {
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
  let response: LoginProcessResponse;
  try {
    response = JSON.parse(text) as LoginProcessResponse;
  } catch {
    await auditLiveRequest({ method: "POST", path, status: res.status, ok: false, note: "non-json" });
    throw new TpoApiError(`login/process returned non-JSON (HTTP ${res.status})`, String(res.status));
  }
  await auditLiveRequest({
    method: "POST",
    path,
    status: res.status,
    ok: response.msg === "200",
    note: response.msg === "200" ? undefined : `business-${response.msg}`,
  });

  return { res, response };
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  try {
    return JSON.parse(await readFile(SESSION_FILE, "utf8")) as StoredSession;
  } catch {
    return null;
  }
}
