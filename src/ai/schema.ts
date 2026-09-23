import { z } from "zod";

/**
 * Structured extraction output (M9). Every field is nullable: the model is
 * instructed to emit null for anything NOT explicitly stated in the source
 * text. Deterministic verification (see verify.ts) then checks that numeric
 * values actually occur in the text — the AI never gets to invent criteria.
 *
 * The three-way distinction demanded by the product spec:
 *   explicitly stated → field is set
 *   not stated        → field is null
 *   uncertain         → field is set, but a note is added to `notes`
 */

export const placementExtractionSchema = z.object({
  role: z.string().nullable(),
  minimumCgpa: z.number().nullable(),
  sscPercentage: z.number().nullable(),
  hscPercentage: z.number().nullable(),
  diplomaPercentage: z.number().nullable(),
  allowedBranches: z.array(z.string()),
  graduationYears: z.array(z.number()),
  /** Normalized backlog policy: "active_allowed" | "no_active_backlogs" | "no_backlogs" | null */
  backlogPolicy: z.enum(["active_allowed", "no_active_backlogs", "no_backlogs"]).nullable(),
  skills: z.array(z.string()),
  locations: z.array(z.string()),
  salary: z.string().nullable(),
  stipend: z.string().nullable(),
  /** ISO date (YYYY-MM-DD) for the application deadline. */
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  selectionStages: z.array(z.string()),
  /** Model self-assessment; low confidence must always be justified in notes. */
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.array(z.string()),
});

export type PlacementExtraction = z.infer<typeof placementExtractionSchema>;

/** Numeric fields that must verifiably occur in the source text. */
export const VERIFIED_NUMERIC_FIELDS = [
  "minimumCgpa",
  "sscPercentage",
  "hscPercentage",
  "diplomaPercentage",
] as const;

export type VerifiedNumericField = (typeof VERIFIED_NUMERIC_FIELDS)[number];

export const EMPTY_EXTRACTION: PlacementExtraction = {
  role: null,
  minimumCgpa: null,
  sscPercentage: null,
  hscPercentage: null,
  diplomaPercentage: null,
  allowedBranches: [],
  graduationYears: [],
  backlogPolicy: null,
  skills: [],
  locations: [],
  salary: null,
  stipend: null,
  deadline: null,
  selectionStages: [],
  confidence: "high",
  notes: [],
};
