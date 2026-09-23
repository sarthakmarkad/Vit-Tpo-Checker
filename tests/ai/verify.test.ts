import { describe, expect, it } from "vitest";
import {
  EMPTY_EXTRACTION,
  placementExtractionSchema,
  type PlacementExtraction,
} from "../../src/ai/schema.js";
import { verifyExtraction } from "../../src/ai/verify.js";

function extraction(overrides: Partial<PlacementExtraction> = {}): PlacementExtraction {
  return { ...EMPTY_EXTRACTION, ...overrides };
}

describe("placementExtractionSchema", () => {
  it("accepts a fully-stated extraction", () => {
    const result = placementExtractionSchema.safeParse({
      role: "Software Engineer",
      minimumCgpa: 7.5,
      sscPercentage: 70,
      hscPercentage: 70,
      diplomaPercentage: null,
      allowedBranches: ["CSE"],
      graduationYears: [2028],
      backlogPolicy: "no_active_backlogs",
      skills: [],
      locations: ["Pune"],
      salary: "16 LPA",
      stipend: "40000",
      deadline: "2026-08-17",
      selectionStages: ["Aptitude", "Interview"],
      confidence: "high",
      notes: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-ISO deadlines and unknown backlog policies", () => {
    expect(
      placementExtractionSchema.safeParse({ ...EMPTY_EXTRACTION, deadline: "17 Aug 2026" })
        .success,
    ).toBe(false);
    expect(
      placementExtractionSchema.safeParse({ ...EMPTY_EXTRACTION, backlogPolicy: "maybe" })
        .success,
    ).toBe(false);
  });

  it("rejects missing fields entirely (schema is total)", () => {
    expect(placementExtractionSchema.safeParse({ role: null }).success).toBe(false);
  });
});

describe("verifyExtraction (deterministic anti-hallucination)", () => {
  const source = [
    "BMC Software internship + PPO drive.",
    "Eligibility: CGPA 7.5 and above, SSC 70%, HSC 70%.",
    "No active backlogs allowed.",
    "Graduating batch 2028.",
  ].join(" ");

  it("keeps numbers that occur in the source text", () => {
    const { extraction: out, removed } = verifyExtraction(
      extraction({ minimumCgpa: 7.5, sscPercentage: 70 }),
      source,
    );
    expect(out.minimumCgpa).toBe(7.5);
    expect(out.sscPercentage).toBe(70);
    expect(removed).toHaveLength(0);
    expect(out.notes).toHaveLength(0);
  });

  it("nulls a number that never appears in the text and records why", () => {
    const { extraction: out, removed } = verifyExtraction(
      extraction({ minimumCgpa: 8.0 },),
      source,
    );
    expect(out.minimumCgpa).toBeNull();
    expect(removed).toEqual(["minimumCgpa"]);
    expect(out.notes.join(" ")).toMatch(/not found in source text/);
  });

  it("handles alternate number spellings (70.0, comma decimals)", () => {
    expect(verifyExtraction(extraction({ sscPercentage: 70.0 }), source).removed).toHaveLength(0);
    const indian = "CGPA 7,5 required";
    expect(verifyExtraction(extraction({ minimumCgpa: 7.5 }), indian).removed).toHaveLength(0);
  });

  it("filters graduation years not present in the text", () => {
    const { extraction: out } = verifyExtraction(
      extraction({ graduationYears: [2028, 2027] }),
      source,
    );
    expect(out.graduationYears).toEqual([2028]);
    expect(out.notes.join(" ")).toMatch(/graduation year 2027/);
  });

  it("downgrades confidence when values are removed", () => {
    const { extraction: out } = verifyExtraction(
      extraction({ minimumCgpa: 9.9, confidence: "high" }),
      source,
    );
    expect(out.confidence).toBe("medium");
  });
});
