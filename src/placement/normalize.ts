import { z } from "zod";
import type {
  NormalizedAttachment,
  PlacementOpportunity,
} from "./types.js";

/**
 * Normalization: raw TPO wire payloads → internal domain model.
 * Deterministic, pure, null-tolerant. Never invents values; unknown/absent
 * fields stay undefined. Raw payloads are preserved for debugging.
 */

// ---------------------------------------------------------------- raw schemas

const rawListEntrySchema = z.looseObject({
  id: z.number(),
  company: z.string(),
  company_code: z.string().nullish(),
  maxPackage: z.number().nullish(),
  minPackage: z.number().nullish(),
  placementtype: z.string().nullish(),
  internshiptype: z.string().nullish(),
  companytype: z.string().nullish(),
  academicyear: z.string().nullish(),
  regStartdatenew: z.string().nullish(),
  regEnddatenew: z.string().nullish(),
  isactive: z.boolean().nullish(),
  programnew: z.array(z.string().nullish()).nullish(),
  organization: z.array(z.string().nullish()).nullish(),
  skill: z.array(z.string().nullish()).nullish(),
});

const rawListSchema = z.looseObject({
  status: z.string(),
  company_list: z.array(rawListEntrySchema),
});

const rawDetailsSchema = z.looseObject({
  msg: z.string(),
  code: z.string(),
  company_name: z.string(),
  criteria: z.array(
    z.looseObject({
      degree: z.string(),
      percentage: z.number().nullish(),
      program: z.string().nullish(),
    }),
  ),
  selction_procedure: z.array(
    z.looseObject({
      round_number: z.number(),
      companyround: z.string(),
      isfinal: z.boolean().nullish(),
    }),
  ),
  // College sends numbers for some drives and free text ("Third Year",
  // "BTech") for others — accept both, normalize downstream.
  programlist: z
    .array(
      z.looseObject({
        program: z.string().nullish(),
        year: z.union([z.number(), z.string()]).nullish(),
      }),
    )
    .nullish(),
  locations: z.array(z.unknown()).nullish(),
  is_live_backlog_allowed: z.boolean().nullish(),
  is_dead_backlog_allowed: z.boolean().nullish(),
  isplacedstudentallowed: z.boolean().nullish(),
  isyeardownallowed: z.boolean().nullish(),
  ishigherstudiesallowed: z.boolean().nullish(),
  minstipend: z.number().nullish(),
  maxstipend: z.number().nullish(),
  stipend_description: z.string().nullish(),
  description: z.string().nullish(),
  job_description: z.string().nullish(),
  bond_description: z.string().nullish(),
});

// ------------------------------------------------------------------- helpers

function isoDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function cleanString(v: string | null | undefined): string | undefined {
  const s = v?.trim();
  return s ? s : undefined;
}

function cleanStringList(
  v: Array<string | null | undefined> | null | undefined,
): string[] | undefined {
  const out = (v ?? [])
    .filter(
      (s): s is string =>
        typeof s === "string" &&
        s.trim().length > 0 &&
        // TPO encodes "no program" as the literal "null" or "ORG-null".
        s.trim().toLowerCase() !== "null" &&
        !s.trim().toLowerCase().endsWith("-null"),
    )
    .map((s) => s.trim());
  return out.length > 0 ? out : undefined;
}

// ---------------------------------------------------------------- list → base

/**
 * List entries are the fast path (one call for everything). Details enrich an
 * existing opportunity — never overwrite list-known identity fields.
 */
export function normalizeListEntry(raw: unknown): PlacementOpportunity {
  const parsed = rawListEntrySchema.parse(raw);
  return {
    externalId: String(parsed.id),
    companyName: parsed.company,
    offeringCode: cleanString(parsed.company_code),
    packageUnit: "LPA",
    package: parsed.maxPackage ?? undefined,
    minPackage: parsed.minPackage ?? undefined,
    placementType: cleanString(parsed.placementtype),
    internshipType: cleanString(parsed.internshiptype),
    companyType: cleanString(parsed.companytype),
    academicYear: cleanString(parsed.academicyear),
    registrationStart: isoDate(parsed.regStartdatenew),
    registrationEnd: isoDate(parsed.regEnddatenew),
    isActive: parsed.isactive ?? undefined,
    programs: cleanStringList(parsed.programnew ?? undefined),
    organizations: cleanStringList(parsed.organization ?? undefined),
    skills: cleanStringList(parsed.skill ?? undefined),
    rawData: raw,
  };
}

export function normalizeList(raw: unknown): PlacementOpportunity[] {
  // Accepts either the full wire payload or a bare array of entries.
  if (Array.isArray(raw)) return raw.map((entry) => normalizeListEntry(entry));
  const parsed = rawListSchema.parse(raw);
  return parsed.company_list.map((entry) => normalizeListEntry(entry));
}

// ------------------------------------------------------------- details → full

/** Merge detail payload into a list-derived opportunity. */
export function applyDetails(
  base: PlacementOpportunity,
  rawDetails: unknown,
): PlacementOpportunity {
  const d = rawDetailsSchema.parse(rawDetails);

  const criteria: Record<string, number | undefined> = {};
  for (const c of d.criteria) {
    if (c.percentage === null || c.percentage === undefined) continue;
    criteria[c.degree.toUpperCase()] = c.percentage;
  }

  const selectionProcess = d.selction_procedure
    .slice()
    .sort((a, b) => a.round_number - b.round_number)
    .map((r) => (r.isfinal ? `${r.companyround} (final)` : r.companyround));

  const programList = cleanStringList(
    (d.programlist ?? []).map((p) => p.program ?? null),
  );

  const gradYears = Array.from(
    new Set(
      (d.programlist ?? [])
        .map((p) => p.year)
        .map((y): number | null => {
          if (typeof y === "number") return y;
          if (typeof y === "string") {
            const n = Number(y);
            return Number.isInteger(n) ? n : null;
          }
          return null;
        })
        // Free-text descriptors ("Third Year", "BTech") are not batch years.
        .filter((y): y is number => y !== null && y >= 2000 && y <= 2100),
    ),
  ).sort((a, b) => a - b);

  return {
    ...base,
    offeringCode: cleanString(d.code),
    minimumCgpa: criteria["GRADUATION"],
    sscPercentage: criteria["SSC"],
    hscPercentage: criteria["HSC"],
    diplomaPercentage: criteria["DIPLOMA"],
    activeBacklogsAllowed: d.is_live_backlog_allowed ?? undefined,
    deadBacklogsAllowed: d.is_dead_backlog_allowed ?? undefined,
    placedStudentsAllowed: d.isplacedstudentallowed ?? undefined,
    yearDownAllowed: d.isyeardownallowed ?? undefined,
    higherStudiesAllowed: d.ishigherstudiesallowed ?? undefined,
    minStipend: d.minstipend ?? undefined,
    maxStipend: d.maxstipend ?? undefined,
    stipendDescription: cleanString(d.stipend_description),
    description: cleanString(d.description),
    jobDescription: cleanString(d.job_description),
    bondDescription: cleanString(d.bond_description),
    selectionProcess: selectionProcess.length > 0 ? selectionProcess : undefined,
    // detail programlist is authoritative (org-qualified, complete)
    programs: programList ?? base.programs,
    graduationYears: gradYears.length > 0 ? gradYears : undefined,
    locations: cleanStringList(
      (d.locations ?? []).map((l) => (typeof l === "string" ? l : null)),
    ),
    rawData: rawDetails,
  };
}

// --------------------------------------------------------------- attachments

export function normalizeAttachments(raw: unknown): NormalizedAttachment[] {
  // Accepts either the full wire payload or a bare array of entries.
  const entries = Array.isArray(raw)
    ? raw
    : z
        .looseObject({ companyOfferingAttachmentList: z.array(z.unknown()) })
        .parse(raw).companyOfferingAttachmentList;
  const parsed = z
    .array(
      z.looseObject({
        id: z.number(),
        filename: z.string(),
        filepath: z.string().nullish(),
      }),
    )
    .parse(entries);
  return parsed.map((a) => ({
    externalId: String(a.id),
    filename: a.filename,
    objectKey: cleanString(a.filepath),
  }));
}
