import { loadEnv, type Env } from "../config/env.js";
import { logger, type Logger } from "../logger.js";
import { auditLiveRequest, countTodayAuditEntries } from "./audit.js";
import { captureRawExchange } from "./capture.js";
import { buildOrderedHeaders } from "./headers.js";
import {
  TpoApiError,
  TpoAuthError,
  TpoMalformedResponseError,
  TpoNetworkError,
  TpoTimeoutError,
} from "./errors.js";
import {
  rawAttachmentListSchema,
  rawOfferingDetailsSchema,
  rawOfferingListSchema,
  rawSessionInfoSchema,
  type RawAttachment,
  type RawCompanyOffering,
  type RawOfferingDetails,
  type RawSessionInfo,
} from "./schemas.js";
import type { TpoSessionProvider, RequestAuth } from "./session.js";

/**
 * HTTP client for the TPO backend. Communication ONLY — no business logic.
 *
 * - Session headers replayed verbatim from the user's legitimate session.
 * - Timeouts on every request; retries only for safe transient failures
 *   (network errors, timeouts, 429, 5xx) with exponential backoff.
 * - Minimal rate limiting between consecutive requests.
 * - Optional dev-only, redacted raw capture (RAW_CAPTURE=debug).
 */

export interface TpoClientConfig {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  minRequestIntervalMs: number;
}

export const defaultTpoClientConfig: TpoClientConfig = {
  baseUrl: "https://tpoapi.vierp.in",
  timeoutMs: 15_000,
  maxRetries: 3,
  minRequestIntervalMs: 1_000,
};

/**
 * Hard guardrail: the college server must never be hammered.
 * 1) Live calls are opt-in via ALLOW_LIVE_API=true.
 * 2) Each client instance enforces a per-run request budget.
 * 3) Daily audit totals are checked before the first call of a run.
 * 4) Every live request is appended to the audit log.
 */
const LIVE_API_HOST = /vierp\.in$/;

class LiveApiDisabledError extends Error {
  constructor() {
    super(
      "Live API calls are disabled (ALLOW_LIVE_API=false). " +
        "The platform will not contact the college server. " +
        "Set ALLOW_LIVE_API=true in .env only when you explicitly want a live sync.",
    );
    this.name = "LiveApiDisabledError";
  }
}

class RequestBudgetExceededError extends Error {
  constructor(budget: number) {
    super(
      `Request budget exceeded for this run (${budget} calls). ` +
        "Aborting to protect the college server from excessive traffic.",
    );
    this.name = "RequestBudgetExceededError";
  }
}

export type FetchFn = typeof globalThis.fetch;

const DEFAULT_ROUTER_PATHS = {
  probe: "/home",
  list: "/company-dashboard",
  details: "/company-info",
  attachments: "/company-info",
} as const;

type EndpointKind = keyof typeof DEFAULT_ROUTER_PATHS;

export class TpoClient {
  private readonly config: TpoClientConfig;
  private readonly sessionProvider: TpoSessionProvider;
  private readonly fetchFn: FetchFn;
  private readonly log: Logger;
  private readonly env: Env;
  private lastRequestAt = 0;
  private callCount = 0;

  constructor(
    sessionProvider: TpoSessionProvider,
    options: Partial<TpoClientConfig> = {},
    fetchFn: FetchFn = globalThis.fetch,
  ) {
    this.env = loadEnv();
    this.config = { ...defaultTpoClientConfig, ...options };
    if (!this.env.ALLOW_LIVE_API && LIVE_API_HOST.test(new URL(this.config.baseUrl).host)) {
      throw new LiveApiDisabledError();
    }
    this.config.minRequestIntervalMs = Math.max(
      this.config.minRequestIntervalMs,
      this.env.API_MIN_REQUEST_INTERVAL_MS,
    );
    this.sessionProvider = sessionProvider;
    this.fetchFn = fetchFn;
    this.log = logger.child({ module: "tpo-client" });
  }

  /** Session health check — the cheapest legitimate validity probe. */
  async probeSession(): Promise<RawSessionInfo> {
    const payload = await this.requestJson("probe", "GET", "/login/slidebardashboardnew");
    expectBusinessOk(payload, "/login/slidebardashboardnew");
    return rawSessionInfoSchema.parse(payload);
  }

  async getCompanyOfferings(): Promise<RawCompanyOffering[]> {
    const path = "/TPOCompanyScheduling/newschedulesdcopanies";
    const payload = await this.requestJson("newschedulesdcopanies", "POST", path, undefined);
    expectBusinessOk(payload, path);
    const parsed = rawOfferingListSchema.parse(payload);
    return parsed.company_list;
  }

  async getCompanyOfferingDetails(offeringId: number): Promise<RawOfferingDetails> {
    const path = "/TPOCompanyScheduling/CompanyofferingInfo";
    const payload = await this.requestJson(
      "CompanyofferingInfo",
      "POST",
      path,
      { offering: offeringId },
    );
    expectBusinessOk(payload, path);
    return rawOfferingDetailsSchema.parse(payload);
  }

  async getAttachments(offeringId: number): Promise<RawAttachment[]> {
    const path = "/TPOCompanyScheduling/getCompanyOfferingForFileAttachment";
    const payload = await this.requestJson(
      "getCompanyOfferingForFileAttachment",
      "POST",
      path,
      { offering: offeringId },
    );
    expectBusinessOk(payload, path);
    const parsed = rawAttachmentListSchema.parse(payload);
    return parsed.companyOfferingAttachmentList;
  }

  // ------------------------------------------------------------------ internals

  private buildHeaders(
    kind: EndpointKind,
    auth: RequestAuth,
    jsonBody: unknown,
  ): Headers {
    // Identical, ordered, browser-shaped headers for every request — the
    // server fingerprints requests, so all calls must present the same shape.
    const headerPairs = buildOrderedHeaders({
      auth: {
        epsUid: auth.epsUid,
        epsTenant: auth.epsTenant,
        deviceSignature: auth.deviceSignature,
        requestTimestamp: auth.requestTimestamp,
        cookieHeader: auth.cookieHeader,
      },
      routerPath: DEFAULT_ROUTER_PATHS[kind],
      hasBody: jsonBody !== undefined,
    });
    const headers = new Headers();
    for (const [name, value] of headerPairs) headers.set(name, value);
    return headers;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    const wait = this.config.minRequestIntervalMs - elapsed;
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private async requestJson(
    name: string,
    method: "GET" | "POST",
    path: string,
    jsonBody?: unknown,
  ): Promise<unknown> {
    // ---- guardrails (see class docs) ----
    if (!this.env.ALLOW_LIVE_API && LIVE_API_HOST.test(new URL(this.config.baseUrl).host)) {
      throw new LiveApiDisabledError();
    }
    if (this.callCount >= this.env.MAX_API_CALLS_PER_RUN) {
      throw new RequestBudgetExceededError(this.env.MAX_API_CALLS_PER_RUN);
    }
    if (this.callCount === 0) {
      const todayCount = await countTodayAuditEntries();
      if (todayCount >= this.env.TPO_DAILY_MAX_API_CALLS) {
        throw new RequestBudgetExceededError(this.env.TPO_DAILY_MAX_API_CALLS);
      }
    }
    this.callCount += 1;

    const kind = (Object.keys(DEFAULT_ROUTER_PATHS) as EndpointKind[]).find(
      (k) =>
        (k === "list" && path.includes("newschedulesdcopanies")) ||
        (k === "details" && path.includes("CompanyofferingInfo")) ||
        (k === "attachments" && path.includes("FileAttachment")) ||
        (k === "probe" && path.includes("slidebardashboardnew")),
    );
    const endpointKind: EndpointKind = kind ?? "list";
    const url = new URL(path, this.config.baseUrl);
    const body = jsonBody === undefined ? undefined : JSON.stringify(jsonBody);
    const auth = await this.sessionProvider.getRequestAuth(method, url.pathname);

    let lastError: unknown;
    const attempts = this.config.maxRetries + 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await this.throttle();
      try {
        const response = await this.fetchFn(url, {
          method,
          headers: this.buildHeaders(endpointKind, auth, body),
          ...(body === undefined ? {} : { body }),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });

        if (response.status === 401 || response.status === 403) {
          await auditLiveRequest({ method, path, status: response.status, ok: false, note: "auth-rejected" });
          throw new TpoAuthError(
            `TPO API rejected the session (HTTP ${response.status}) on ${path}. ` +
              "Session headers have likely expired — paste a fresh set into .env.",
            response.status,
          );
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = new TpoNetworkError(
            `TPO API returned retryable HTTP ${response.status} on ${path}`,
          );
          await auditLiveRequest({ method, path, status: response.status, ok: false, note: "retryable" });
          this.log.warn(
            { path, status: response.status, attempt },
            "retryable HTTP status from TPO API",
          );
        } else if (!response.ok) {
          await auditLiveRequest({ method, path, status: response.status, ok: false, note: "unexpected" });
          throw new TpoApiError(
            `TPO API returned unexpected HTTP ${response.status} on ${path}`,
            String(response.status),
          );
        } else {
          const json = await parseJsonBody(response, path);
          const rec = json as Record<string, unknown> | null;
          const code = rec && typeof rec === "object" ? (rec.status ?? rec.msg) : null;
          await auditLiveRequest({
            method,
            path,
            status: response.status,
            ok: code === "200",
            note: code === "200" ? undefined : `business-${String(code)}`,
          });
          await captureRawExchange(name, { method, url: url.toString(), routerPath: DEFAULT_ROUTER_PATHS[endpointKind] }, json);
          return json;
        }
      } catch (err) {
        if (err instanceof TpoApiError || err instanceof TpoAuthError || err instanceof TpoMalformedResponseError) {
          throw err;
        }
        if (isAbortError(err)) {
          lastError = new TpoTimeoutError(this.config.timeoutMs);
          await auditLiveRequest({ method, path, ok: false, note: "timeout" });
          this.log.warn({ path, attempt }, "request timed out");
        } else if (err instanceof TypeError) {
          lastError = new TpoNetworkError(`Network failure calling ${path}`, { cause: err });
          await auditLiveRequest({ method, path, ok: false, note: "network" });
          this.log.warn({ path, attempt }, "network failure");
        } else {
          lastError = err;
        }
      }
      if (attempt < attempts) {
        await sleep(backoffMs(attempt));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new TpoNetworkError(`Unknown failure calling ${path}`);
  }
}

function backoffMs(attempt: number): number {
  const base = 300 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * base * 0.25);
}

/**
 * Gate on the API's own business status ("msg" or "status" == "200")
 * before full schema validation, so rejection payloads (which may lack
 * data fields) produce a precise TpoApiError instead of a schema error.
 */
function expectBusinessOk(payload: unknown, path: string): void {
  if (!isRecordLike(payload)) {
    throw new TpoMalformedResponseError(`Response of ${path} is not an object`);
  }
  const code = payload.status ?? payload.msg;
  if (typeof code !== "string" || code !== "200") {
    throw new TpoApiError(
      `TPO API rejected ${path} (code=${String(code)})`,
      typeof code === "string" ? code : "unknown",
    );
  }
}

function isRecordLike(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      err.name === "AbortSignalTimeoutError")
  );
}

async function parseJsonBody(response: Response, path: string): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    throw new TpoMalformedResponseError(`Could not read response body of ${path}`, { cause: err });
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new TpoMalformedResponseError(
      `Response of ${path} is not valid JSON (first 200 chars: ${text.slice(0, 200)})`,
      { cause: err },
    );
  }
}
