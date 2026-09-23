import { prisma } from "../database/client.js";
import { logger } from "../logger.js";
import {
  evaluateEligibility,
  statusIcon,
  type EligibilityResult,
} from "../eligibility/engine.js";

/**
 * Eligibility report (M11): evaluates every active placement against the
 * student profile and prints an explainable report. Deterministic only —
 * the same input always yields the same verdict, with per-check reasoning.
 */

function jsonLists(value: unknown): string[] {
  return Array.isArray(value) ? (value.filter((v) => typeof v === "string") as string[]) : [];
}

async function main(): Promise<void> {
  const profile = await prisma.studentProfile.findFirst({
    include: { user: true },
  });
  if (!profile) {
    console.log("No profile yet — run: npm run profile -- set cgpa=8.2 branch=CSE ...");
    return;
  }

  const opportunities = await prisma.placementOpportunity.findMany({
    where: { isActive: true },
    include: { requirements: true },
    orderBy: [{ registrationEnd: "asc" }, { companyName: "asc" }],
  });

  if (opportunities.length === 0) {
    console.log("No active placements stored yet (run a sync first).");
    return;
  }

  const profileInput = {
    branch: profile.branch,
    graduationYear: profile.graduationYear,
    cgpa: profile.cgpa,
    sscPercentage: profile.sscPercentage,
    hscPercentage: profile.hscPercentage,
    diplomaPercentage: profile.diplomaPercentage,
    activeBacklogs: profile.activeBacklogs,
    deadBacklogs: profile.deadBacklogs,
  };

  const results: Array<{
    company: string;
    externalId: string;
    deadline: string;
    result: EligibilityResult;
  }> = [];

  for (const opp of opportunities) {
    const result = evaluateEligibility(
      {
        minimumCgpa: opp.minimumCgpa,
        sscPercentage: opp.sscPercentage,
        hscPercentage: opp.hscPercentage,
        diplomaPercentage: opp.diplomaPercentage,
        graduationYears: Array.isArray(opp.graduationYears)
          ? (opp.graduationYears.filter((y) => typeof y === "number") as number[])
          : null,
        programs: jsonLists(opp.programs),
        activeBacklogsAllowed: opp.activeBacklogsAllowed,
        deadBacklogsAllowed: opp.deadBacklogsAllowed,
      },
      profileInput,
    );
    results.push({
      company: opp.companyName,
      externalId: opp.externalId,
      deadline: opp.registrationEnd?.toISOString().slice(0, 10) ?? "—",
      result,
    });
  }

  const order = { not_eligible: 0, uncertain: 1, eligible: 2 } as const;
  results.sort((a, b) => order[a.result.status] - order[b.result.status]);

  for (const r of results) {
    console.log(`${statusIcon(r.result.status)} ${r.company} (#${r.externalId}) · deadline ${r.deadline}`);
    for (const check of r.result.checks) {
      console.log(
        `   ${check.criterion.padEnd(16)} ${check.required.padEnd(24)} you: ${check.actual.padEnd(12)} ${check.status}`,
      );
    }
    console.log("");
  }
  const counts = {
    eligible: results.filter((r) => r.result.status === "eligible").length,
    uncertain: results.filter((r) => r.result.status === "uncertain").length,
    not_eligible: results.filter((r) => r.result.status === "not_eligible").length,
  };
  console.log(
    `${counts.eligible} eligible · ${counts.uncertain} uncertain · ${counts.not_eligible} not eligible`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    logger.error({ err: String(err) }, "eligibility report failed");
    await prisma.$disconnect();
    process.exit(1);
  });
