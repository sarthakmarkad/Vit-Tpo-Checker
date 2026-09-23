/**
 * Minimal cookie jar for the TPO API session.
 * The API authenticates via HttpOnly cookies (EPS_TOKEN / EPS_REFRESH_TOKEN)
 * set at login — the browser stores them automatically; we store them in the
 * gitignored session file and attach them on every request.
 */

export interface CookieJar {
  /** name → raw value */
  [name: string]: string;
}

interface SetCookieParsed {
  name: string;
  value: string;
  expires?: Date;
}

function parseSetCookie(header: string): SetCookieParsed | null {
  const [pair = "", ...attrs] = header.split(";");
  const eq = pair.indexOf("=");
  if (eq < 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  const parsed: SetCookieParsed = { name, value };
  for (const attr of attrs) {
    const [k, v] = attr.split("=");
    if (k?.trim().toLowerCase() === "expires") {
      const d = new Date(v?.trim() ?? "");
      if (!Number.isNaN(d.getTime())) parsed.expires = d;
    }
  }
  return parsed;
}

/** Merge Set-Cookie headers into the jar, honouring expiry/deletion. */
export function updateJar(jar: CookieJar, setCookieHeaders: string[]): CookieJar {
  const out: CookieJar = { ...jar };
  for (const header of setCookieHeaders) {
    const parsed = parseSetCookie(header);
    if (!parsed) continue;
    if (parsed.expires && parsed.expires.getTime() < Date.now()) {
      delete out[parsed.name];
    } else {
      out[parsed.name] = parsed.value;
    }
  }
  return out;
}

/** Serialize the jar for a Cookie request header. */
export function serializeJar(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}
