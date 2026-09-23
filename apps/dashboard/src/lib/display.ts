import { evaluateEligibility, statusIcon, type EligibilityResult } from "../../../../src/eligibility/engine";
import type { PlacementOpportunity, StudentProfile } from "@prisma/client";

/** Shared dashboard helpers: eligibility over Prisma rows (no logic duplication). */

export function profileInput(p: StudentProfile | null) {
  if (!p) return {};
  return {
    branch: p.branch,
    graduationYear: p.graduationYear,
    cgpa: p.cgpa,
    sscPercentage: p.sscPercentage,
    hscPercentage: p.hscPercentage,
    diplomaPercentage: p.diplomaPercentage,
    activeBacklogs: p.activeBacklogs,
    deadBacklogs: p.deadBacklogs,
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? (value.filter((v): v is string => typeof v === "string") as string[])
    : [];
}

export function eligibilityFor(opp: PlacementOpportunity, p: StudentProfile | null): EligibilityResult {
  return evaluateEligibility(
    {
      minimumCgpa: opp.minimumCgpa,
      sscPercentage: opp.sscPercentage,
      hscPercentage: opp.hscPercentage,
      diplomaPercentage: opp.diplomaPercentage,
      graduationYears: Array.isArray(opp.graduationYears)
        ? (opp.graduationYears.filter((y): y is number => typeof y === "number") as number[])
        : null,
      programs: stringList(opp.programs),
      activeBacklogsAllowed: opp.activeBacklogsAllowed,
      deadBacklogsAllowed: opp.deadBacklogsAllowed,
    },
    profileInput(p),
  );
}

export { statusIcon };

export function lpa(value: number | null): string {
  return value === null ? "—" : `${value} LPA`;
}

export function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export function daysLeft(d: Date | null): number | null {
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}
