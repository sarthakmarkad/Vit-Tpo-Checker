import crypto from "node:crypto";
import type { PlacementOpportunity } from "./types.js";

/**
 * Canonical representation of an opportunity for deterministic change
 * detection. Volatile/debug fields (rawData, sourceUrl) are excluded.
 * Object keys are sorted recursively so hash input is stable.
 */

const HASHED_FIELDS = [
  "companyName",
  "offeringCode",
  "package",
  "minPackage",
  "packageUnit",
  "placementType",
  "internshipType",
  "companyType",
  "academicYear",
  "registrationStart",
  "registrationEnd",
  "minimumCgpa",
  "sscPercentage",
  "hscPercentage",
  "diplomaPercentage",
  "activeBacklogsAllowed",
  "deadBacklogsAllowed",
  "placedStudentsAllowed",
  "yearDownAllowed",
  "higherStudiesAllowed",
  "programs",
  "graduationYears",
  "organizations",
  "skills",
  "locations",
  "minStipend",
  "maxStipend",
  "stipendDescription",
  "description",
  "jobDescription",
  "bondDescription",
  "selectionProcess",
  "isActive",
] as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function canonicalHash(opp: PlacementOpportunity): string {
  const projection: Record<string, unknown> = {};
  const record = opp as unknown as Record<string, unknown>;
  for (const field of HASHED_FIELDS) {
    const v = record[field];
    if (v === undefined) continue;
    if (v instanceof Date) {
      projection[field] = v.toISOString();
      continue;
    }
    projection[field] = v;
  }
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(projection)))
    .digest("hex");
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}
