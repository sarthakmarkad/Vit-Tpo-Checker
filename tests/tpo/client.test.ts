import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
// Tests use a mocked fetch — they must neither write to nor be gated by the
// live-API audit log (the daily cap counts only real college-server traffic).
vi.mock("../../src/tpo/audit.js", () => ({
  auditLiveRequest: vi.fn(async () => {}),
  countTodayAuditEntries: vi.fn(async () => 0),
}));
import { TpoClient } from "../../src/tpo/client.js";
import { TpoAuthError, TpoMalformedResponseError, TpoTimeoutError } from "../../src/tpo/errors.js";
import { EnvTpoSessionProvider, SigningSessionProvider } from "../../src/tpo/session.js";
import { loadOrCreateDeviceKey } from "../../src/tpo/device.js";

const SESSION = new EnvTpoSessionProvider({
  epsUid: "test-uid",
  epsTenant: "test-tenant",
  deviceSignature: "test-signature",
  requestTimestamp: 1790140884202,
});

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

const OFFERING_DETAILS_OK = {
  msg: "200",
  code: "BMC2026-271",
  company_name: "BMC Software",
  selction_procedure: [{ round_number: 1, companyround: "Technical Interview", isfinal: false }],
  criteria: [{ id: 5580, degree: "Graduation", percentage: 8.0, program: "All", criteria_number: 4 }],
  minpackage: 16.0,
  maxpackage: 16.0,
  programlist: [{ org: "VIT", year: null, program: "BTech CSE" }],
  companyoffering: { id: 5705 },
};

const ATTACHMENTS_OK = {
  msg: "200",
  token_status: "NC",
  company_name: "BMC Software",
  companyOfferingAttachmentList: [
    {
      id: 9373,
      filename: "Details of BMC.pdf",
      filepath: "Company_Attachments/VIT/BMC Software/2026-27/asr6dnsk5opdf",
      fileUrl: "https://easyplacements.s3.ap-south-1.amazonaws.com/x?X-Amz-Expires=86400",
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchCall = { url: string; init?: RequestInit };

function makeClient(
  handler: (call: FetchCall, attempt: number) => Response | Promise<Response>,
  opts: { maxRetries?: number } = {},
): { client: TpoClient; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let attempt = 0;
  const fetchFn = vi.fn(
    async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: url.toString(), init });
      const res = await handler(calls[calls.length - 1] as FetchCall, ++attempt);
      return res;
    },
  ) as unknown as typeof globalThis.fetch;
  const client = new TpoClient(SESSION, {
    maxRetries: opts.maxRetries ?? 2,
    minRequestIntervalMs: 0,
  }, fetchFn);
  return { client, calls };
}

describe("TpoClient", () => {
  it("fetches the company list on success", async () => {
    const { client, calls } = makeClient(() => jsonResponse(OFFERING_LIST_OK));
    const list = await client.getCompanyOfferings();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(5705);
    expect(list[0]?.company).toBe("BMC Software");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/TPOCompanyScheduling/newschedulesdcopanies");
  });

  it("sends the session headers verbatim on every request", async () => {
    const { client, calls } = makeClient(() => jsonResponse(OFFERING_LIST_OK));
    await client.getCompanyOfferings();
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("eps-uid")).toBe("test-uid");
    expect(headers.get("eps-tenant")).toBe("test-tenant");
    expect(headers.get("x-device-signature")).toBe("test-signature");
    expect(headers.get("x-request-timestamp")).toBe("1790140884202");
    expect(headers.get("eps-purpose")).toBe("API Call");
    expect(headers.get("router-path")).toBe("/company-dashboard");
  });

  it("mints a fresh signature per request via SigningSessionProvider", async () => {
    const deviceKey = await loadOrCreateDeviceKey();
    const provider = new SigningSessionProvider(
      { epsUid: "test-uid", epsTenant: "test-tenant", epsUsertype: "", uid: "u", tenant: "t", usertype: "", loggedInAt: new Date().toISOString() },
      deviceKey,
    );
    const a = await provider.getRequestAuth("POST", "/TPOCompanyScheduling/newschedulesdcopanies");
    expect(a.deviceSignature).toBeTruthy();
    // signature must verify against the registered public key
    const sig = Buffer.from(a.deviceSignature as string, "base64");
    const key = crypto.createPublicKey({
      key: Buffer.from((await loadOrCreateDeviceKey()).publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    const payload = `POST:/TPOCompanyScheduling/newschedulesdcopanies:${a.requestTimestamp}`;
    expect(
      crypto.verify("sha256", Buffer.from(payload), { key, dsaEncoding: "ieee-p1363" }, sig),
    ).toBe(true);
    // different payloads (different path) yield different signatures
    const c = await provider.getRequestAuth("GET", "/login/slidebardashboardnew");
    expect(c.deviceSignature).not.toBe(a.deviceSignature);
  });

  it("fetches offering details with the {offering} JSON body", async () => {
    const { client, calls } = makeClient(() => jsonResponse(OFFERING_DETAILS_OK));
    const details = await client.getCompanyOfferingDetails(5705);
    expect(details.company_name).toBe("BMC Software");
    expect(details.criteria).toHaveLength(1);
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ offering: 5705 }));
    expect(new Headers(calls[0]?.init?.headers).get("router-path")).toBe("/company-info");
  });

  it("fetches attachments", async () => {
    const { client } = makeClient(() => jsonResponse(ATTACHMENTS_OK));
    const list = await client.getAttachments(5705);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(9373);
  });

  it("validates the session via probeSession", async () => {
    const { client } = makeClient(() =>
      jsonResponse({ msg: "200", usertype: "Student", name: "X" }),
    );
    const info = await client.probeSession();
    expect(info.usertype).toBe("Student");
  });

  it("throws TpoAuthError without retrying on HTTP 401", async () => {
    const { client, calls } = makeClient(() => jsonResponse({ msg: "401" }, 401));
    await expect(client.getCompanyOfferings()).rejects.toBeInstanceOf(TpoAuthError);
    expect(calls).toHaveLength(1);
  });

  it("retries a transient 500 and succeeds on a later attempt", async () => {
    const { client, calls } = makeClient(
      (call, attempt) => (attempt === 1 ? jsonResponse("boom", 500) : jsonResponse(OFFERING_LIST_OK)),
    );
    const list = await client.getCompanyOfferings();
    expect(list).toHaveLength(1);
    expect(calls.length).toBe(2);
  });

  it("gives up after retries on persistent timeouts", async () => {
    const { client, calls } = makeClient(
      () => {
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      },
      { maxRetries: 1 },
    );
    await expect(client.getCompanyOfferings()).rejects.toBeInstanceOf(TpoTimeoutError);
    expect(calls).toHaveLength(2);
  });

  it("does not retry on malformed JSON", async () => {
    const { client, calls } = makeClient(
      () => new Response("<html>login</html>", { status: 200 }),
    );
    await expect(client.getCompanyOfferings()).rejects.toBeInstanceOf(
      TpoMalformedResponseError,
    );
    expect(calls).toHaveLength(1);
  });

  it("maps a non-200 business status to TpoApiError", async () => {
    const { client } = makeClient(() => jsonResponse({ status: "400" }));
    await expect(client.getCompanyOfferings()).rejects.toMatchObject({
      name: "TpoApiError",
      code: "400",
    });
  });

  it("fails fast with a clear message when session headers are missing", async () => {
    const { client } = makeClient(() => jsonResponse(OFFERING_LIST_OK));
    const emptySession = new EnvTpoSessionProvider({});
    const c = new TpoClient(emptySession, { minRequestIntervalMs: 0 }, client["fetchFn"]);
    await expect(c.getCompanyOfferings()).rejects.toThrow(/TPO_EPS_UID/);
  });
});
