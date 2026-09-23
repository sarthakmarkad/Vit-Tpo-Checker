import { loadEnv } from "../config/env.js";
import { logger } from "../logger.js";
import { TpoClient } from "../tpo/client.js";
import { TpoError, TpoSessionMissingError } from "../tpo/errors.js";
import { SigningSessionProvider } from "../tpo/session.js";

/**
 * Live probe of the TPO API using the logged-in session (M2 gate).
 * Order: session check → company list → details → attachments.
 * Never prints session header values.
 */

const env = loadEnv();
const log = logger.child({ script: "tpo-probe" });

async function main(): Promise<number> {
  const provider = await SigningSessionProvider.create();
  const client = new TpoClient(provider);

  log.info("── STEP 1/4: session check (GET /login/slidebardashboardnew)");
  const session = await client.probeSession();
  log.info({ usertype: session.usertype }, "session accepted ✓");

  log.info("── STEP 2/4: fetch company list (POST /newschedulesdcopanies)");
  const list = await client.getCompanyOfferings();
  log.info({ count: list.length }, "company list fetched ✓");
  for (const o of list) {
    log.info(
      { id: o.id, company: o.company, code: o.company_code ?? null, packageLPA: o.maxPackage },
      "offering",
    );
  }

  const first = list[0];
  if (!first) {
    log.warn("no offerings in list — skipping detail probes");
    return 0;
  }

  log.info({ offeringId: first.id }, "── STEP 3/4: offering details (POST /CompanyofferingInfo)");
  const details = await client.getCompanyOfferingDetails(first.id);
  log.info(
    {
      company: details.company_name,
      code: details.code,
      criteria: details.criteria.map((c) => `${c.degree} >= ${c.percentage}`),
      rounds: details.selction_procedure.map((r) => r.companyround),
    },
    "details fetched ✓",
  );

  log.info({ offeringId: first.id }, "── STEP 4/4: attachments (POST /getCompanyOfferingForFileAttachment)");
  const attachments = await client.getAttachments(first.id);
  log.info({ count: attachments.length }, "attachments fetched ✓");
  for (const a of attachments) {
    log.info({ id: a.id, filename: a.filename }, "attachment");
  }

  log.info("PROBE COMPLETE — session reuse works ✓");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    if (err instanceof Error && err.name === "LiveApiDisabledError") {
      log.error(err.message);
      process.exit(3);
    }
    if (err instanceof TpoSessionMissingError) {
      log.error({ err: err.message }, "no session available");
      log.error("→ Run `npm run login` first.");
      process.exit(2);
    }
    if (err instanceof TpoError) {
      log.error({ err: err.message }, "probe failed");
      log.error(
        err instanceof Error && err.name === "TpoAuthError"
          ? "→ Session invalid. Do NOT retry repeatedly (the college server must not be hammered). " +
            "Wait, then run `npm run login` once if needed."
          : "→ See docs/tpo-api-analysis.md for the expected wire contract.",
      );
      process.exit(1);
    }
    log.error({ err }, "unexpected probe failure");
    process.exit(1);
  });
