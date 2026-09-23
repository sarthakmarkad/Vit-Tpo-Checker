# TPO API Analysis (tpo.vierp.in)

Source of truth: a HAR capture of an authenticated session
(`tpo.vierp.in.har`, 621 entries, captured from `tpo.vierp.in/company-dashboard`).
All secret values (session headers, signed URLs, PII) were redacted during
analysis; this document only describes structure and field names.

> ⚠️ The `.har` file itself must never be committed (see `.gitignore`).

## 1. Hosts

| Host | Role |
|---|---|
| `https://tpo.vierp.in` | Vue SPA (frontend), static assets |
| `https://tpoapi.vierp.in` | JSON API (EduplusCampus "EPS" platform) |
| `https://easyplacements.s3.ap-south-1.amazonaws.com` | Attachment storage (pre-signed S3 URLs) |

## 2. Authentication (fully reverse-engineered from the public SPA JS)

Derived from `app.4f28bf35.js` (axios interceptor + device-crypto module) and
the login chunk `chunk-bc3b6b2a`. All mechanisms below are client-side logic
the browser performs; our client replicates the same behavior for the user's
own account. Nothing is bypassed.

### 2.1 Identity headers

| Header | Content |
|---|---|
| `EPS-uid` | **AES-256-ECB(PKCS7)** of the raw uid string (e.g. `"12400000@vit.edu"`), base64. Static key shipped in the SPA JS. |
| `EPS-tenant` | AES-256-ECB of the tenant id (e.g. `"tpovi"`). |
| `EPS-purpose` | constant `"API Call"`. |
| `X-Device-Signature` | **ECDSA P-256 / SHA-256** signature (base64 DER) over the exact string `` `METHOD:PATH:TIMESTAMP` `` (e.g. `GET:/login/slidebardashboardnew:1790140884202`). Minted fresh per request. |
| `X-Request-Timestamp` | ms-epoch used inside the signature payload. |
| `router-path` | SPA route (e.g. `/home`, `/company-dashboard`) — NOT the API path. |

The signature key is an ECDSA P-256 keypair generated **per device at login**
(WebCrypto `generateKey`, private key non-extractable, stored in IndexedDB
`security-store/keyval → device_private_key`). The **public key (base64 SPKI)
is registered with the server as part of the login payload**. The server
therefore validates every request against the key bound to that account.

When the private key is missing, the SPA sends the request **without** the two
signature headers (server rejects with the generic 401 body noted in §3.1).

### 2.2 Login flow (`POST /login/process`)

1. `GET https://tpoapi.vierp.in/api/altcha/challenge` → ALTCHA PoW challenge.
2. Client solves the puzzle (`sha256(salt + number) === challenge`) and builds
   `payload = base64(JSON{algorithm, challenge, number, salt, signature})`.
3. Client generates a fresh device keypair (public key → `publicKey`).
4. `payload = {uid, pass, publicKey, altcha}` → AES-256-ECB encrypted
   (same static key) → POST body `{"params": "<ciphertext>"}`.
5. Response `{msg:"200", uid, tenant, usertype, policy_read}` — the client
   encrypts `uid`/`tenant`/`usertype` and stores them in localStorage as
   `EPS-uid` / `EPS-tenant` / `EPS-usertype`.
6. There is an ERP-SSO variant: `POST /login/erp_check {data: <encrypted>}`.

### 2.3 Session cookies (the missing piece — confirmed by live test)

The login response sets **HttpOnly, Secure, SameSite=Strict cookies** on the
API domain:

| Cookie | Role |
|---|---|
| `EPS_TOKEN` | JWT — the actual API session token ("Missing required headers **or token**") |
| `EPS_REFRESH_TOKEN` | JWT — used by `POST /login/refresh` |
| `token` | empty placeholder |
| `AWSALB` / `AWSALBCORS` | load-balancer affinity |

The browser sends these automatically (`axios withCredentials=true`). Both are
required together: cookies + per-request ECDSA signature.

### 2.4 Device binding — root cause found and resolved

Observed during live testing: requests failed with
*"SECURITY ALERT: Session Hijacking Attempt Blocked! Expected \<H1\> but got \<H2\>"*
where both digests were **constant** across fresh logins and device keys.

Diagnosis: the gateway fingerprints the **request header shape**. A login made
with a minimal header set and API calls made with a different (or partial)
header set fail the fingerprint comparison — regardless of signature or
session validity.

**Resolution (implemented):** every request — including the login itself — is
sent with the **exact same, ordered, Chrome-identical header set**
(`src/tpo/headers.ts`): accept, accept-language, eps-purpose, eps-tenant,
eps-uid, origin, priority, referer, router-path, sec-ch-ua*,
sec-fetch-*, user-agent, x-device-signature, x-request-timestamp, cookie,
content-type (JSON bodies only). With identical shapes, login re-binds the
device key and all four endpoints return `msg:"200"`.

Additional confirmed details:
- `x-device-signature` must be **raw IEEE-P1363 (r||s)** base64 — WebCrypto's
  format — not DER.
- JWTs are HS256 with `sub/username/type/exp` claims; a fresh `EPS_TOKEN` is
  issued per login.

### 2.5 Safety guardrails (mandatory, implemented)

Because every request touches the college's server, the platform enforces:

1. **Live calls are opt-in**: `ALLOW_LIVE_API=false` (default) makes the client
   refuse any request to the real API host.
2. **Request budgets**: `MAX_API_CALLS_PER_RUN` (per client instance) and a
   hard daily ceiling (4× run budget) derived from the audit log.
3. **Minimum spacing** between requests (`API_MIN_REQUEST_INTERVAL_MS`, ≥1 s).
4. **Audit log**: every live request appended to gitignored
   `var/api-audit.log` (timestamp, method, path, status — no secrets).
5. **No auto-relogin**: on auth failure the run STOPS with a clear message;
   re-login is always a deliberate, manual `npm run login`. Never a retry storm.
6. Syncs are periodic (default 30 min), tiny (1 list call + N detail calls),
   sequential, and idempotent.

## 3. Endpoints (exact contracts observed)

### 3.1 `GET /login/slidebardashboardnew`

Session / user-context probe. Empty body.

```json
{
  "msg": "200",
  "grno_empcode": "<redacted>",
  "name": "<redacted>",
  "username": "<redacted>",
  "usertype": "Student",
  "notification_list": [],
  "links": [ { "name": "Student", "links": [ { "link": "company-dashboard", "link_name": "Companies Dashboard" } ] } ]
}
```

Use as a pre-sync **session health check**. Non-`200` `msg` or HTTP error ⇒ session expired.

### 3.2 `POST /TPOCompanyScheduling/newschedulesdcopanies`

Company/offering list. **Empty body** (`content-length: 0`), no pagination, no filters.

Response: `{ "status": "200", "company_list": [...] }` — captured 3 items; two
identical calls returned byte-identical payloads (stable, good for change detection).

Per-item fields observed:

```text
id (int, external offering id, e.g. 5705)
company (str), company_code (str, e.g. "BMC2026-271")
minPackage / maxPackage (float, LPA)
placementtype (str, e.g. "Internship + Performance based PPO")
companytype (str, e.g. "Regular"), academicyear (str, "2026-27"), semester (null)
regStartdate / regEnddate (display, "13-Aug-2026")
regStartdatenew / regEnddatenew (ISO, "2026-08-12T18:30:00Z")
regStarttime / regEndtime ("16:15" / "10:00")
from_schedule_date / to_schedule_date (null in capture)
locations, placement_process_locations, job_description (nullable)
contact_person_name, contact_email, contact_phone (nullable)
industry[], skill[] (lists), internshiptype (nullable str)
isactive (bool), isoffertobeacceptedbystudent (bool)
tpoprogram[] (e.g. "VIT-B.Tech. Computer Science and Artificial Intelligence")
programnew[] ([null, "..."]) — index 0 may be null
organization[] (e.g. ["VIT"])
```

### 3.3 `POST /TPOCompanyScheduling/CompanyofferingInfo`

Request: `{"offering": <id>}` (JSON).

Response (top-level):

```text
msg: "200"
code: company offering code
company_name
selction_procedure[]: { round_number, companyround, isfinal }   (sic — "selction")
criteria[]: { id, degree ("SSC"|"HSC"|"Diploma"|"Graduation"), percentage, program, criteria_number }
programlist[]: { org, year (nullable), program }
finalDegreeList[]: { id, name, type ("CPI"|"Percentage") }
degree[]: names
minpackage / maxpackage / dream_company_package (float)
placementtype, description, remark
minstipend / maxstipend (float)
backlog (bool), is_dead_backlog_allowed, is_live_backlog_allowed, isplacedstudentallowed
isinternstudentallowed, isyeardownallowed, ishigherstudiesallowed
internship_type, placement_mode, companytype, semester, locations[]
instructionlist[], specificcriteria, collaborators[], incharge_faculty
bond_description, job_description, token_status, industrytype
companyoffering{}: ~60 raw fields incl. reg dates/times, stipend_description,
package_description, contact info, creation/update metadata, ids
```

Notables:
- `criteria[]` is the machine-readable eligibility matrix (SSC/HSC/Diploma/Graduation percentages, `program: "All"` observed).
- Stipend may be `0` while `stipend_description` carries the real prose.
- `companyoffering` object keys vs top-level keys overlap but are not identical; treat the **top-level** summary as canonical for domain mapping, keep `companyoffering` in `rawData`.

### 3.4 `POST /TPOCompanyScheduling/getCompanyOfferingForFileAttachment`

Request: `{"offering": <id>}` (JSON).

```json
{
  "msg": "200",
  "token_status": "NC",
  "company_name": "BMC Software",
  "companyOfferingAttachmentList": [
    { "id": 9373,
      "filename": "Details of  BMC Internship + PPO  for 2028  batch  13 Aug 2026.pdf",
      "filepath": "Company_Attachments/VIT/BMC Software/2026-27/asr6dnsk5opdf",
      "fileUrl": "https://easyplacements.s3...?X-Amz-Algorithm=...&X-Amz-Expires=86400&X-Amz-Signature=..." }
  ]
}
```

- `fileUrl` is a **pre-signed S3 URL valid ~24h** (`X-Amz-Expires=86400`).
  Never persist; download promptly when needed and store only metadata + local file.
- Empty list ⇒ no attachments.

## 4. CORS / transport notes

- Cross-origin preflight (`OPTIONS`) observed for the JSON POSTs.
- Content-Type for JSON POSTs: `application/json;charset=UTF-8`.
- Responses are small (<5 KB); gzip handled by the client stack transparently.

## 5. Security considerations

- The HAR/session carries live credentials and student PII ⇒ gitignored; `.env`
  holds session values; only `.env.example` is committed.
- Signed URLs expire (~24 h) — do not store them as durable data.
- No auth-bypass work: ALTCHA/CAPTCHA and any rate limits are respected. The
  platform only replays **the user's own legitimate session** and reads data the
  user can already see in their browser.

## 6. Session strategy (as implemented)

The manual-paste strategy was tested first and **failed** (per-request ECDSA
binding + freshness window). The implemented strategy is a first-party client:

1. `npm run login` — generates our ECDSA P-256 device key, solves the ALTCHA
   challenge genuinely, encrypts `{uid, pass, publicKey, altcha}` with the
   platform's client-side key, and posts to `/login/process`.
2. The session (`EPS-uid`/`EPS-tenant` header values) is stored in gitignored
   `var/tpo-session.json`; the device key in `var/tpo-device.json`.
3. Every API call mints a fresh `METHOD:PATH:TIMESTAMP` signature — identical
   to what the browser does. `POST /login/refresh` is available for renewal.
4. No credential storage outside gitignored local files; no bypassing of any
   mechanism (ALTCHA is solved, not circumvented).

Session-expiry handling: `probeSession()` before syncs; on `TpoAuthError`
re-run `npm run login` (can be automated later via refresh).

## 7. Open questions

- Exact token lifetime / invalidation triggers for `eps-uid` + `eps-tenant`.
- Whether `x-device-signature` is validated server-side (probe will tell).
- Whether `newschedulesdcopanies` filters by the logged-in student server-side
  (compare list vs `tpoprogram` in session — to verify on first live sync).
