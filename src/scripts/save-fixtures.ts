import { writeFile, mkdir } from "node:fs/promises";
import { loadEnv } from "../config/env.js";
import { logger } from "../logger.js";
import { TpoClient } from "../tpo/client.js";
import { SigningSessionProvider } from "../tpo/session.js";

/**
 * Saves live API fixtures for offline test development (tests/fixtures/).
 * GUARDRAILED: ALLOW_LIVE_API=true required. ~3 live calls per run.
 */

const env = loadEnv();
if (!env.ALLOW_LIVE_API) {
  throw new Error("ALLOW_LIVE_API=false — refusing to contact the college server.");
}
const log = logger.child({ script: "save-fixtures" });

async function main(): Promise<void> {
  const client = new TpoClient(await SigningSessionProvider.create());
  const list = await client.getCompanyOfferings();
  const details = await client.getCompanyOfferingDetails(list[0]!.id);
  const attachments = await client.getAttachments(list[0]!.id);
  await mkdir("tests/fixtures", { recursive: true });
  await writeFile("tests/fixtures/company-list.json", JSON.stringify(list, null, 2));
  await writeFile("tests/fixtures/offering-details.json", JSON.stringify(details, null, 2));
  await writeFile("tests/fixtures/attachments.json", JSON.stringify(attachments, null, 2));
  log.info(
    { companies: list.length, company: details.company_name, attachments: attachments.length },
    "fixtures saved",
  );
}
void main();
