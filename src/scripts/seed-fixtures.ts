import { readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../database/client.js";
import { logger } from "../logger.js";
import { applyDetails, normalizeList } from "../placement/normalize.js";
import { canonicalHash } from "../placement/canonical.js";

/**
 * Dev utility: seed the database from saved live fixtures (offline dev).
 * Not part of the sync pipeline — fixtures live in tests/fixtures/ and the
 * DB rows are ordinary records (a real sync will update/replace them).
 */

const FIXTURES = path.join("tests", "fixtures");

function toJson(value: unknown): unknown {
  return value && typeof value === "object" ? value : null;
}

/** Strip undefined values so create/update inputs build cleanly. */
function omitUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

async function main(): Promise<void> {
  const listRaw = JSON.parse(await readFile(path.join(FIXTURES, "company-list.json"), "utf8"));
  const detailsRaw = JSON.parse(
    await readFile(path.join(FIXTURES, "offering-details.json"), "utf8"),
  );

  const opportunities = normalizeList(listRaw);
  let created = 0;
  for (const opp of opportunities) {
    // The details fixture holds one payload — apply it to the matching entry.
    let full = opp;
    try {
      const code = (detailsRaw as { code?: unknown }).code;
      if (code === opp.offeringCode) {
        full = applyDetails(opp, detailsRaw);
      }
    } catch {
      logger.warn({ externalId: opp.externalId }, "details fixture did not match; storing list-level");
    }
    const data = omitUndefined({
      externalId: full.externalId,
      companyName: full.companyName,
      offeringCode: full.offeringCode,
      packageLpa: full.package,
      minPackageLpa: full.minPackage,
      placementType: full.placementType,
      internshipType: full.internshipType,
      companyType: full.companyType,
      academicYear: full.academicYear,
      registrationStart: full.registrationStart,
      registrationEnd: full.registrationEnd,
      minimumCgpa: full.minimumCgpa,
      sscPercentage: full.sscPercentage,
      hscPercentage: full.hscPercentage,
      diplomaPercentage: full.diplomaPercentage,
      activeBacklogsAllowed: full.activeBacklogsAllowed,
      deadBacklogsAllowed: full.deadBacklogsAllowed,
      placedStudentsAllowed: full.placedStudentsAllowed,
      yearDownAllowed: full.yearDownAllowed,
      higherStudiesAllowed: full.higherStudiesAllowed,
      programs: full.programs ?? [],
      graduationYears: full.graduationYears ?? [],
      organizations: full.organizations ?? [],
      skills: full.skills ?? [],
      locations: full.locations ?? [],
      minStipend: full.minStipend,
      maxStipend: full.maxStipend,
      stipendDescription: full.stipendDescription,
      description: full.description,
      jobDescription: full.jobDescription,
      bondDescription: full.bondDescription,
      selectionProcess: full.selectionProcess ?? [],
      isActive: full.isActive ?? true,
      contentHash: canonicalHash(full),
      rawData: toJson(full.rawData),
    });
    await prisma.placementOpportunity.upsert({
      where: { externalId: full.externalId },
      create: data as Prisma.PlacementOpportunityUncheckedCreateInput,
      update: data as Prisma.PlacementOpportunityUncheckedUpdateInput,
    });
    created += 1;
  }
  console.log(`seeded ${created} opportunities from fixtures`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    logger.error({ err: String(err) }, "fixture seeding failed");
    await prisma.$disconnect();
    process.exit(1);
  });
