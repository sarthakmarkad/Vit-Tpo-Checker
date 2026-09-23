import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyDetails,
  normalizeAttachments,
  normalizeList,
  normalizeListEntry,
} from "../../src/placement/normalize.js";

const fixturesDir = new URL("../fixtures/", import.meta.url).pathname;
const companyListRaw = JSON.parse(readFileSync(`${fixturesDir}/company-list.json`, "utf8"));
const detailsRaw = JSON.parse(readFileSync(`${fixturesDir}/offering-details.json`, "utf8"));
const attachmentsRaw = JSON.parse(readFileSync(`${fixturesDir}/attachments.json`, "utf8"));

describe("normalization — live fixtures", () => {
  it("normalizes the full live company list", () => {
    const list = normalizeList(companyListRaw);
    expect(list).toHaveLength(4);
    const bmc = list.find((o) => o.externalId === "5705");
    expect(bmc?.companyName).toBe("BMC Software");
    expect(bmc?.package).toBe(16);
    expect(bmc?.packageUnit).toBe("LPA");
    expect(bmc?.registrationEnd).toEqual(new Date("2026-08-16T18:30:00Z"));
    expect(bmc?.programs).toContain("B.Tech. Computer Science and Artificial Intelligence");
  });

  it("filters null program entries", () => {
    const list = normalizeList(companyListRaw);
    const bmc = list.find((o) => o.externalId === "5705");
    expect(bmc?.programs?.every((p) => !p.toLowerCase().includes("null"))).toBe(true);
  });

  it("applies details: criteria, rounds, stipend, programs", () => {
    const base = normalizeListEntry(companyListRaw[0]);
    const full = applyDetails(base, detailsRaw);
    expect(full.minimumCgpa).toBe(8);
    expect(full.sscPercentage).toBe(70);
    expect(full.hscPercentage).toBe(70);
    expect(full.diplomaPercentage).toBe(70);
    expect(full.activeBacklogsAllowed).toBe(false);
    expect(full.deadBacklogsAllowed).toBe(false);
    expect(full.minStipend).toBe(25000);
    expect(full.selectionProcess).toEqual([
      "Technical Interview",
      "Completed Internship but cant get PPO (final)",
    ]);
    expect(full.offeringCode).toBe("BMC2026-271");
    expect(full.programs?.length).toBeGreaterThan(0);
  });

  it("normalizes attachments without signed URLs", () => {
    const atts = normalizeAttachments(attachmentsRaw);
    expect(atts).toHaveLength(1);
    expect(atts[0]?.filename).toContain("BMC");
    expect(atts[0]?.objectKey).toBeTruthy();
    // signed URL must never leak into the domain model
    expect(JSON.stringify(atts)).not.toContain("X-Amz-Signature");
  });

  it("preserves rawData for debugging", () => {
    const base = normalizeListEntry(companyListRaw[0]);
    expect(base.rawData).toBeDefined();
  });
});

describe("normalization — edge cases", () => {
  it("tolerates missing/null fields", () => {
    const opp = normalizeListEntry({
      id: 1,
      company: "X",
      maxPackage: null,
      placementtype: null,
      regStartdatenew: null,
      programnew: [null, null],
      organization: [],
      skill: [],
    });
    expect(opp.package).toBeUndefined();
    expect(opp.placementType).toBeUndefined();
    expect(opp.registrationStart).toBeUndefined();
    expect(opp.programs).toBeUndefined();
    expect(opp.organizations).toBeUndefined();
  });

  it("rejects entries without id/company", () => {
    expect(() => normalizeListEntry({ id: 1 })).toThrow();
    expect(() => normalizeListEntry({ company: "X" })).toThrow();
  });

  it("handles empty list payload", () => {
    expect(normalizeList({ status: "200", company_list: [] })).toEqual([]);
  });

  it("treats 'null' string programs as absent", () => {
    const opp = normalizeListEntry({
      id: 2,
      company: "Y",
      programnew: ["VIT-null", "BTech CSE"],
    });
    expect(opp.programs).toEqual(["BTech CSE"]);
  });

  it("applies details with absent criteria gracefully", () => {
    const base = normalizeListEntry({ id: 3, company: "Z" });
    const full = applyDetails(base, {
      msg: "200",
      code: "Z1",
      company_name: "Z",
      criteria: [],
      selction_procedure: [],
    });
    expect(full.minimumCgpa).toBeUndefined();
    expect(full.selectionProcess).toBeUndefined();
    expect(full.offeringCode).toBe("Z1");
  });

  it("sorts selection rounds by round number", () => {
    const base = normalizeListEntry({ id: 4, company: "W" });
    const full = applyDetails(base, {
      msg: "200",
      code: "W1",
      company_name: "W",
      criteria: [],
      selction_procedure: [
        { round_number: 2, companyround: "HR", isfinal: true },
        { round_number: 1, companyround: "Aptitude", isfinal: false },
      ],
    });
    expect(full.selectionProcess).toEqual(["Aptitude", "HR (final)"]);
  });
});
