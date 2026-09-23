import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { loadEnv } from "../config/env.js";
import { logger } from "../logger.js";
import { auditLiveRequest } from "../tpo/audit.js";

/**
 * Replays the browser's own copied cURL ONCE (ground-truth baseline) and
 * extracts its auth ingredients for OFFLINE formula comparison.
 * GUARDRAILED: ALLOW_LIVE_API=true required. Exactly one live call.
 */

const env = loadEnv();
if (!env.ALLOW_LIVE_API) {
  throw new Error("ALLOW_LIVE_API=false — refusing to contact the college server.");
}
const log = logger.child({ script: "replay-browser-curl" });

interface ParsedCurl {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function parseCurl(text: string): ParsedCurl {
  // Join line continuations, then tokenize respecting single quotes.
  const joined = text
    .split("\\\n")
    .map((l) => l.trim())
    .join(" ");
  const tokens: string[] = [];
  const re = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(joined))) {
    let t = m[0];
    if (t.startsWith("'") && t.endsWith("'")) t = t.slice(1, -1);
    else if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
    tokens.push(t);
  }
  const parsed: ParsedCurl = { url: "", method: "GET", headers: {} };
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i] as string;
    if (!parsed.url && t.startsWith("http")) parsed.url = t;
    if (t === "-H" || t === "--header") {
      const v = tokens[i + 1] as string;
      const idx = v.indexOf(":");
      if (idx > 0) {
        const name = v.slice(0, idx).trim();
        const value = v.slice(idx + 1).trim();
        parsed.headers[name.toLowerCase()] = value;
      }
      i += 2;
      continue;
    }
    if (t === "--data-raw" || t === "--data" || t === "-d") {
      const v = tokens[i + 1];
      if (typeof v === "string") {
        parsed.body = v;
        parsed.method = "POST";
      }
      i += 2;
      continue;
    }
    if (t === "-X" || t === "--request") {
      parsed.method = (tokens[i + 1] as string).toUpperCase();
      i += 2;
      continue;
    }
    i += 1;
  }
  return parsed;
}

async function main(): Promise<void> {
  const raw = await readFile("var/browser-curl.txt", "utf8");
  const curlText = raw
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
  const parsed = parseCurl(curlText);
  if (!parsed.url) throw new Error("could not parse URL from var/browser-curl.txt");

  const cookieNames = (parsed.headers["cookie"] ?? "")
    .split(";")
    .map((c) => c.split("=")[0]?.trim())
    .filter(Boolean);
  log.info(
    {
      url: parsed.url,
      method: parsed.method,
      headerNames: Object.keys(parsed.headers),
      cookieNames,
    },
    "parsed browser request",
  );

  const res = await fetch(parsed.url, {
    method: parsed.method,
    headers: parsed.headers,
    ...(parsed.body === undefined ? {} : { body: parsed.body }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text();
  await auditLiveRequest({
    method: parsed.method,
    path: new URL(parsed.url).pathname,
    status: res.status,
    ok: body.includes('"msg":"200"'),
    note: "browser-replay",
  });
  log.info({ status: res.status, bodyPreview: body.slice(0, 200) }, "replay result");

  // Persist (gitignored) for offline formula analysis.
  await writeFile(
    "var/browser-replay.json",
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        request: {
          url: parsed.url,
          method: parsed.method,
          headers: parsed.headers,
          body: parsed.body ?? null,
        },
        response: { status: res.status, body },
      },
      null,
      2,
    ),
  );
  log.info("saved var/browser-replay.json — offline analysis next");
}

void main();
