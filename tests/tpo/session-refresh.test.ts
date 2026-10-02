import { beforeEach, describe, expect, it, vi } from "vitest";
// Tests use mocked fetch/audit — no network, no audit-log writes, and the
// real first-party login flow must never run inside a test.
vi.mock("../../src/tpo/audit.js", () => ({
  auditLiveRequest: vi.fn(async () => {}),
  countTodayAuditEntries: vi.fn(async () => 0),
}));
vi.mock("../../src/tpo/login.js", () => ({
  login: vi.fn(async () => {
    throw new Error("real login must not run in tests");
  }),
  loadStoredSession: vi.fn(async () => null),
}));
import { TpoClient } from "../../src/tpo/client.js";
import { SigningSessionProvider } from "../../src/tpo/session.js";
import { loadOrCreateDeviceKey } from "../../src/tpo/device.js";
import { login, loadStoredSession, type StoredSession } from "../../src/tpo/login.js";
import { TpoAuthError } from "../../src/tpo/errors.js";
import type { RequestAuth, TpoSessionProvider } from "../../src/tpo/session.js";

const OFFERING_LIST_OK = {
  status: "200",
  company_list: [
    {
      id: 5705,
      company: "BMC Software",
      company_code: "BMC2026-271",
      minPackage: 16.0,
      maxPackage: 16.0,
      placementtype: "Internship + Performance based PPO",
      regStartdatenew: "2026-08-12T18:30:00Z",
      regEnddatenew: "2026-08-16T18:30:00Z",
      isactive: true,
      tpoprogram: ["VIT-B.Tech. Computer Science and Artificial Intelligence"],
      programnew: [null, "B.Tech. Computer Science and Artificial Intelligence"],
      organization: ["VIT"],
      skill: [],
      industry: [],
    },
  ],
};

function makeSession(token: string): StoredSession {
  return {
    epsUid: "enc-uid",
    epsTenant: "enc-tenant",
    epsUsertype: "enc-type",
    uid: "u",
    tenant: "tpovi",
    usertype: "Student",
    cookies: { EPS_TOKEN: token },
    loggedInAt: new Date().toISOString(),
  };
}

function fakeProvider(refreshImpl: () => Promise<boolean>): TpoSessionProvider {
  return {
    getRequestAuth: vi.fn(
      async (): Promise<RequestAuth> => ({
        epsUid: "test-uid",
        epsTenant: "test-tenant",
        deviceSignature: "test-signature",
        requestTimestamp: "1790140884202",
        cookieHeader: "EPS_TOKEN=old",
      }),
    ),
    refreshAfterAuthFailure: vi.fn(refreshImpl),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClientWithProvider(
  provider: TpoSessionProvider,
  handler: (attempt: number) => Response,
): { client: TpoClient; calls: Array<{ url: string }> } {
  const calls: Array<{ url: string }> = [];
  let attempt = 0;
  const fetchFn = vi.fn(
    async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: url.toString() });
      void init;
      return handler(++attempt);
    },
  ) as unknown as typeof globalThis.fetch;
  const client = new TpoClient(provider, { maxRetries: 2, minRequestIntervalMs: 0 }, fetchFn);
  return { client, calls };
}

describe("TpoClient auth-refresh retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries once after an automatic session refresh on HTTP 401", async () => {
    const provider = fakeProvider(async () => true);
    const { client, calls } = makeClientWithProvider(
      provider,
      (attempt) =>
        attempt === 1 ? jsonResponse({ msg: "401" }, 401) : jsonResponse(OFFERING_LIST_OK),
    );
    const list = await client.getCompanyOfferings();
    expect(list).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(provider.refreshAfterAuthFailure).toHaveBeenCalledTimes(1);
    expect(provider.getRequestAuth).toHaveBeenCalledTimes(2);
  });

  it("throws TpoAuthError without retrying when the refresh fails", async () => {
    const provider = fakeProvider(async () => false);
    const { client, calls } = makeClientWithProvider(
      provider,
      () => jsonResponse({ msg: "401" }, 401),
    );
    await expect(client.getCompanyOfferings()).rejects.toBeInstanceOf(TpoAuthError);
    expect(calls).toHaveLength(1);
  });

  it("performs at most one refresh per request even if the session stays rejected", async () => {
    const provider = fakeProvider(async () => true);
    const { client, calls } = makeClientWithProvider(
      provider,
      () => jsonResponse({ msg: "401" }, 401),
    );
    await expect(client.getCompanyOfferings()).rejects.toBeInstanceOf(TpoAuthError);
    expect(calls).toHaveLength(2);
    expect(provider.refreshAfterAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("refreshes and retries on a business-code 401 delivered as HTTP 200", async () => {
    const provider = fakeProvider(async () => true);
    const { client, calls } = makeClientWithProvider(
      provider,
      (attempt) =>
        attempt === 1 ? jsonResponse({ msg: "401" }) : jsonResponse(OFFERING_LIST_OK),
    );
    const list = await client.getCompanyOfferings();
    expect(list).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("does not refresh on non-auth business errors", async () => {
    const provider = fakeProvider(async () => true);
    const { client } = makeClientWithProvider(provider, () => jsonResponse({ status: "400" }));
    await expect(client.getCompanyOfferings()).rejects.toMatchObject({ code: "400" });
    expect(provider.refreshAfterAuthFailure).not.toHaveBeenCalled();
  });
});

describe("SigningSessionProvider.refreshAfterAuthFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-logins from credentials and swaps the session", async () => {
    const deviceKey = await loadOrCreateDeviceKey();
    const loginFn = vi.fn(async () => makeSession("B"));
    const provider = new SigningSessionProvider(makeSession("A"), deviceKey, {
      loginFn,
      refreshCooldownMs: 0,
      credentials: { username: "u@vit.edu", password: "p" },
    });

    const before = await provider.getRequestAuth("POST", "/x");
    expect(before.cookieHeader).toContain("EPS_TOKEN=A");

    await expect(provider.refreshAfterAuthFailure()).resolves.toBe(true);
    expect(loginFn).toHaveBeenCalledWith("u@vit.edu", "p");

    const after = await provider.getRequestAuth("POST", "/x");
    expect(after.cookieHeader).toContain("EPS_TOKEN=B");
  });

  it("throttles refresh attempts with a cooldown", async () => {
    const deviceKey = await loadOrCreateDeviceKey();
    const loginFn = vi.fn(async () => makeSession("B"));
    const provider = new SigningSessionProvider(makeSession("A"), deviceKey, {
      loginFn,
      refreshCooldownMs: 60_000,
      credentials: { username: "u", password: "p" },
    });

    await expect(provider.refreshAfterAuthFailure()).resolves.toBe(true);
    await expect(provider.refreshAfterAuthFailure()).resolves.toBe(false);
    expect(loginFn).toHaveBeenCalledTimes(1);
  });

  it("returns false when the automatic re-login fails", async () => {
    const deviceKey = await loadOrCreateDeviceKey();
    const provider = new SigningSessionProvider(makeSession("A"), deviceKey, {
      loginFn: async () => {
        throw new Error("wrong password");
      },
      refreshCooldownMs: 0,
      credentials: { username: "u", password: "p" },
    });
    await expect(provider.refreshAfterAuthFailure()).resolves.toBe(false);
  });

  it("reloads the session from disk when no credentials are configured", async () => {
    const deviceKey = await loadOrCreateDeviceKey();
    vi.mocked(loadStoredSession).mockResolvedValue(makeSession("B"));
    const provider = new SigningSessionProvider(makeSession("A"), deviceKey, {
      refreshCooldownMs: 0,
      credentials: null,
    });

    await expect(provider.refreshAfterAuthFailure()).resolves.toBe(true);
    expect(vi.mocked(login)).not.toHaveBeenCalled();

    const after = await provider.getRequestAuth("POST", "/x");
    expect(after.cookieHeader).toContain("EPS_TOKEN=B");
  });
});
