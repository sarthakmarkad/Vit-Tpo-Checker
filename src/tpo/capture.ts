import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnv } from "../config/env.js";
import { logger } from "../logger.js";

/**
 * Dev-only raw capture of API exchanges, for debugging the wire contract.
 * - Only enabled when RAW_CAPTURE=debug (see .env.example) — never in production.
 * - Sensitive values are redacted BEFORE anything is written.
 * - Output lives in gitignored var/debug-captures/.
 */

const CAPTURE_DIR = join("var", "debug-captures");

const REDACTED = "[redacted]";

/** Keys whose values must never be persisted, in any nested position. */
const SENSITIVE_KEYS = new Set([
  "epsuid",
  "epstenant",
  "x-device-signature",
  "xdevicesignature",
  "deviceSignature",
  "authorization",
  "cookie",
  "grno_empcode",
  "grnoempcode",
]);

const SENSITIVE_VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/X-Amz-(Credential|Signature|SignedHeaders)=[^&\s"]+/g, "X-Amz-$1=[redacted]"],
  [/AKIA[0-9A-Z]{16}/g, "[redacted-aws-key]"],
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function redact(value: unknown, keyHint = ""): unknown {
  if (typeof value === "string") {
    let s = value;
    for (const [pattern, replacement] of SENSITIVE_VALUE_PATTERNS) {
      s = s.replace(pattern, replacement);
    }
    return s;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redact(v));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase()) || SENSITIVE_KEYS.has(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redact(v, k);
      }
    }
    return out;
  }
  return value;
}

export async function captureRawExchange(
  name: string,
  request: { method: string; url: string; routerPath: string },
  responseBody: unknown,
): Promise<void> {
  const env = loadEnv();
  if (env.RAW_CAPTURE !== "debug" || env.NODE_ENV === "production") return;
  try {
    await mkdir(CAPTURE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(CAPTURE_DIR, `${stamp}-${name}.json`);
    const payload = {
      capturedAt: new Date().toISOString(),
      request: {
        method: request.method,
        url: request.url,
        routerPath: request.routerPath,
        headers: redact({
          // Only structural context — never the session headers themselves.
          epsUid: "[redacted-present]",
          epsTenant: "[redacted-present]",
          deviceSignature: "[redacted-present]",
        }),
      },
      response: redact(responseBody),
    };
    await writeFile(file, JSON.stringify(payload, null, 2));
    logger.debug({ file }, "raw exchange captured (redacted)");
  } catch (err) {
    // Capturing must never break the sync.
    logger.warn({ err }, "failed to write raw capture");
  }
}
