import pino from "pino";
import { loadEnv } from "./config/env.js";

/**
 * Structured logger. Secrets must never reach logs; we rely on disciplined
 * call sites plus pino redaction as a safety net for the known header keys.
 */
export const logger = pino({
  level: loadEnv().LOG_LEVEL,
  redact: {
    paths: [
      "epsUid",
      "epsTenant",
      "deviceSignature",
      "requestTimestamp",
      "*.epsUid",
      "*.epsTenant",
      "*.deviceSignature",
      "headers.eps-uid",
      "headers.eps-tenant",
      "headers['x-device-signature']",
    ],
    censor: "[redacted]",
  },
});

export type Logger = pino.Logger;
