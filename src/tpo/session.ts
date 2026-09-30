import { TpoSessionMissingError } from "./errors.js";
import { loadStoredSession, type StoredSession } from "./login.js";
import { loadOrCreateDeviceKey, signRequestPayload, type DeviceKey } from "./device.js";
import { serializeJar } from "./cookies.js";

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

/**
 * Production provider: logged-in session + our own registered device key.
 * Mints a fresh signature per request and attaches the session cookies —
 * indistinguishable from the browser.
 */
export class SigningSessionProvider implements TpoSessionProvider {
  private readonly session: StoredSession;
  private readonly deviceKey: DeviceKey;

  constructor(session: StoredSession, deviceKey: DeviceKey) {
    this.session = session;
    this.deviceKey = deviceKey;
  }

  static async create(): Promise<SigningSessionProvider> {
    const session = await loadStoredSession();
    if (!session) {
      throw new TpoSessionMissingError([
        "no stored TPO session — run `npm run login` first",
      ]);
    }
    const deviceKey = await loadOrCreateDeviceKey();
    return new SigningSessionProvider(session, deviceKey);
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
}
