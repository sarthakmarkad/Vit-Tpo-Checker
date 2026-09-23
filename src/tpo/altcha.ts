import crypto from "node:crypto";
import { loadEnv } from "../config/env.js";
import { logger } from "../logger.js";
import { TpoApiError, TpoNetworkError } from "./errors.js";

/**
 * ALTCHA proof-of-work solver.
 *
 * ALTCHA is a client-side proof-of-work challenge (an anti-mass-registration /
 * anti-bot-cost mechanism, not a secret). We solve it exactly like the browser
 * widget does: find `number` such that HEX(SHA256(salt + number)) === challenge,
 * then produce the same base64 payload the widget emits. This is the intended
 * use of the mechanism — no bypass, the puzzle is genuinely solved.
 */

const log = logger.child({ module: "altcha" });

interface AltchaChallenge {
  algorithm: string;
  challenge: string;
  salt: string;
  signature: string;
  maxnumber?: number;
}

interface AltchaSolution {
  number: number;
  took: number;
}

export interface AltchaResult {
  challenge: AltchaChallenge;
  solution: AltchaSolution;
  /** base64 JSON payload — what the widget sets as detail.payload */
  payload: string;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function solve(challenge: AltchaChallenge): AltchaSolution | null {
  const started = Date.now();
  const max = challenge.maxnumber ?? 10_000_000;
  for (let n = 0; n <= max; n++) {
    if (sha256Hex(`${challenge.salt}${n}`) === challenge.challenge) {
      return { number: n, took: Date.now() - started };
    }
  }
  return null;
}

export async function solveAltcha(): Promise<AltchaResult> {
  const env = loadEnv();
  const url = new URL("/api/altcha/challenge", env.TPO_API_BASE_URL).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new TpoNetworkError(`ALTCHA challenge fetch failed: HTTP ${res.status}`);
  }
  const challenge = (await res.json()) as AltchaChallenge;
  log.debug({ algorithm: challenge.algorithm }, "altcha challenge received");

  const solution = solve(challenge);
  if (!solution) {
    throw new TpoApiError("ALTCHA proof-of-work could not be solved in range", "altcha");
  }
  const payload = Buffer.from(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      number: solution.number,
      salt: challenge.salt,
      signature: challenge.signature,
    }),
    "utf8",
  ).toString("base64");
  log.info({ number: solution.number, ms: solution.took }, "altcha solved ✓");
  return { challenge, solution, payload };
}
