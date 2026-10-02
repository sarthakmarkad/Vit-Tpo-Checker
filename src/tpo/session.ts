import { TpoSessionMissingError } from "./errors.js";
import { loadStoredSession, login, type StoredSession } from "./login.js";
import { loadOrCreateDeviceKey, signRequestPayload, type DeviceKey } from "./device.js";
import { serializeJar } from "./cookies.js";
import { loadEnv } from "../config/env.js";
import { logger } from "../logger.js";

/**
 * Per-request auth material.
 * The device signature is minted fresh for every request, exactly like the SPA
 * does: ECDSA P-256 over "METHOD:PATH:TIMESTAMP" (base64 DER).
 */
export interface RequestAuth {
  epsUid: string;
  epsTenant: string;
  deviceSignature: string | null;
  requestTimestamp: string | null;
  /** Auth cookies (EPS_TOKEN etc.) — the browser sends these automatically. */
  cookieHeader: string | null;
}

export interface TpoSessionProvider {
  getRequestAuth(method: string, pathname: string): Promise<RequestAuth>;
  /**
   * Optional self-healing hook: called by TpoClient when the API rejects the
   * session (HTTP 401/403 or business-code 401). Returns true when the session
   * material may have changed and the rejected request is worth retrying.
   */
  refreshAfterAuthFailure?(): Promise<boolean>;
}

/**
 * Legacy provider: replays a pasted (method/path-bound) tuple.
 * Kept for tests and diagnostics — live API rejects cross-request replay.
 */
export class EnvTpoSessionProvider implements TpoSessionProvider {
  constructor(
    private readonly values: {
      epsUid?: string;
      epsTenant?: string;
      deviceSignature?: string;
      requestTimestamp?: string | number | null;
    },
  ) {}

  async getRequestAuth(): Promise<RequestAuth> {
    const missing: string[] = [];
    if (!this.values.epsUid) missing.push("TPO_EPS_UID");
    if (!this.values.epsTenant) missing.push("TPO_EPS_TENANT");
    if (!this.values.deviceSignature) missing.push("TPO_DEVICE_SIGNATURE");
    if (missing.length > 0) throw new TpoSessionMissingError(missing);

    return {
      epsUid: this.values.epsUid as string,
      epsTenant: this.values.epsTenant as string,
      deviceSignature: this.values.deviceSignature as string,
      requestTimestamp:
        this.values.requestTimestamp == null
          ? null
          : String(this.values.requestTimestamp),
      cookieHeader: null,
    };
  }
}

export interface SessionRefreshOptions {
  /** Injected for tests; defaults to the real first-party login flow. */
  loginFn?: (username: string, password: string) => Promise<StoredSession>;
  /** Minimum spacing between automatic refresh attempts (default 10 min). */
  refreshCooldownMs?: number;
  /** Explicit credentials override; null disables auto-login (disk reload only). */
  credentials?: { username: string; password: string } | null;
}

/**
 * Production provider: logged-in session + our own registered device key.
 * Mints a fresh signature per request and attaches the session cookies —
 * indistinguishable from the browser.
 *
 * Self-healing: when the API rejects the session, refreshAfterAuthFailure()
 * re-logs-in from .env credentials (device key + ALTCHA, same flow as
 * `npm run login`) or, without credentials, reloads var/tpo-session.json
 * from disk. Throttled so a permanently invalid password cannot hammer
 * the login endpoint.
 */
export class SigningSessionProvider implements TpoSessionProvider {
  private session: StoredSession;
  private readonly deviceKey: DeviceKey;
  private readonly loginFn: (username: string, password: string) => Promise<StoredSession>;
  private readonly refreshCooldownMs: number;
  private readonly credentials: { username: string; password: string } | null | undefined;
  private readonly log = logger.child({ module: "tpo-session" });
  private lastRefreshAt = 0;

  constructor(
    session: StoredSession,
    deviceKey: DeviceKey,
    options: SessionRefreshOptions = {},
  ) {
    this.session = session;
    this.deviceKey = deviceKey;
    this.loginFn = options.loginFn ?? login;
    this.refreshCooldownMs = options.refreshCooldownMs ?? 10 * 60_000;
    this.credentials = options.credentials;
  }

  static async create(
    options: SessionRefreshOptions = {},
  ): Promise<SigningSessionProvider> {
    const session = await loadStoredSession();
    if (!session) {
      throw new TpoSessionMissingError([
        "no stored TPO session — run `npm run login` first",
      ]);
    }
    const deviceKey = await loadOrCreateDeviceKey();
    return new SigningSessionProvider(session, deviceKey, options);
  }

  async getRequestAuth(method: string, pathname: string): Promise<RequestAuth> {
    const ts = Date.now().toString();
    const signature = signRequestPayload(this.deviceKey, method, pathname, ts);
    const jar = this.session.cookies ?? {};
    const hasToken = Object.keys(jar).length > 0;
    return {
      epsUid: this.session.epsUid,
      epsTenant: this.session.epsTenant,
      deviceSignature: signature,
      requestTimestamp: ts,
      cookieHeader: hasToken ? serializeJar(jar) : null,
    };
  }

  async refreshAfterAuthFailure(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastRefreshAt < this.refreshCooldownMs) {
      this.log.warn("auth refresh skipped — cooling down from a recent attempt");
      return false;
    }
    this.lastRefreshAt = now;
    try {
      // undefined = not specified (fall back to .env); null = explicitly disable auto-login
      const creds = this.credentials !== undefined ? this.credentials : credentialsFromEnv();
      if (creds) {
        this.log.info("session rejected — re-logging in automatically");
        this.session = await this.loginFn(creds.username, creds.password);
      } else {
        const reloaded = await loadStoredSession();
        if (!reloaded) {
          this.log.warn("session rejected and no credentials configured; disk reload failed");
          return false;
        }
        this.log.info("session rejected — reloading stored session from disk");
        this.session = reloaded;
      }
      return true;
    } catch (err) {
      this.log.error({ err: String(err) }, "automatic session refresh failed");
      return false;
    }
  }
}

function credentialsFromEnv(): { username: string; password: string } | null {
  const env = loadEnv();
  return env.TPO_USERNAME && env.TPO_PASSWORD
    ? { username: env.TPO_USERNAME, password: env.TPO_PASSWORD }
    : null;
}
