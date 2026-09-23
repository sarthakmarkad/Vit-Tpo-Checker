import { describe, expect, it } from "vitest";
import {
  evaluateEligibility,
  type PlacementEligibilityInput,
  type ProfileEligibilityInput,
} from "../../src/eligibility/engine.js";

/**
 * Deterministic eligibility rules. Every case maps to the product spec:
 * eligible / not_eligible / uncertain, with explainable per-check output.
 */

function placement(overrides: Partial<PlacementEligibilityInput> = {}): PlacementEligibilityInput {
  return {
    minimumCgpa: 7.5,
    sscPercentage: 70,
    hscPercentage: 70,
    diplomaPercentage: null,
    graduationYears: [2028],
    programs: ["VIT-B.Tech. Computer Science and Artificial Intelligence"],
    activeBacklogsAllowed: false,
    deadBacklogsAllowed: true,
    ...overrides,
  };
}

function profile(overrides: Partial<ProfileEligibilityInput> = {}): ProfileEligibilityInput {
  return {
    branch: "Computer Science",
    graduationYear: 2028,
    cgpa: 8.2,
    sscPercentage: 85,
    hscPercentage: 78,
    diplomaPercentage: null,
    activeBacklogs: 0,
    deadBacklogs: 0,
    ...overrides,
  };
}

describe("eligibility engine — deterministic rules", () => {
  it("eligible when every criterion is satisfied", () => {
    const result = evaluateEligibility(placement(), profile());
    expect(result.status).toBe("eligible");
    expect(result.checks).toHaveLength(8);
    expect(result.checks.find((c) => c.criterion === "CGPA")?.status).toBe("satisfied");
    expect(result.reasons).toHaveLength(0);
  });

  it("not_eligible when CGPA fails, with an explainable reason", () => {
    const result = evaluateEligibility(placement(), profile({ cgpa: 7.0 }));
    expect(result.status).toBe("not_eligible");
    expect(result.reasons).toContain("CGPA: required ≥ 7.5, you have 7");
  });

  it("not_eligible when graduation year is not in the drive's years", () => {
    const result = evaluateEligibility(placement(), profile({ graduationYear: 2027 }));
    expect(result.status).toBe("not_eligible");
    expect(result.checks.find((c) => c.criterion === "Graduation year")?.status).toBe(
      "failed",
    );
  });

  it("not_eligible when active backlogs exist and are not allowed", () => {
    const result = evaluateEligibility(placement(), profile({ activeBacklogs: 2 }));
    expect(result.status).toBe("not_eligible");
    expect(result.reasons.join(" ")).toMatch(/Active backlogs/);
  });

  it("not_eligible when dead backlogs exist and are not allowed", () => {
    const result = evaluateEligibility(
      placement({ deadBacklogsAllowed: false }),
      profile({ deadBacklogs: 1 }),
    );
    expect(result.status).toBe("not_eligible");
  });

  it("uncertain when the profile is missing a stated criterion", () => {
    const result = evaluateEligibility(placement(), profile({ cgpa: null }));
    expect(result.status).toBe("uncertain");
    expect(result.checks.find((c) => c.criterion === "CGPA")?.status).toBe("unknown");
    expect(result.reasons.join(" ")).toMatch(/cannot verify/);
  });

  it("uncertain (never failed) on branch naming mismatch", () => {
    const result = evaluateEligibility(
      placement(),
      profile({ branch: "Mechanical Engineering" }),
    );
    expect(result.status).toBe("uncertain");
    expect(result.checks.find((c) => c.criterion === "Branch")?.status).toBe("unknown");
  });

  it("branch matches on token overlap with the program list", () => {
    const result = evaluateEligibility(
      placement(),
      profile({ branch: "CSE" }),
    );
    const branch = result.checks.find((c) => c.criterion === "Branch");
    expect(branch?.status).toBe("satisfied");
  });

  it("no stated requirement → satisfied, not unknown", () => {
    const result = evaluateEligibility(
      placement({
        minimumCgpa: null,
        sscPercentage: null,
        graduationYears: null,
        programs: null,
        activeBacklogsAllowed: null,
      }),
      profile({ cgpa: null }),
    );
    expect(result.status).toBe("eligible");
  });

  it("failed beats uncertain in overall status", () => {
    const result = evaluateEligibility(
      placement(),
      profile({ cgpa: 5, sscPercentage: null }),
    );
    expect(result.status).toBe("not_eligible");
  });
});
