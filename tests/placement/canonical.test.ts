import { describe, expect, it } from "vitest";
import { canonicalHash } from "../../src/placement/canonical.js";
import type { PlacementOpportunity } from "../../src/placement/types.js";

function makeOpp(overrides: Partial<PlacementOpportunity> = {}): PlacementOpportunity {
  return {
    externalId: "1",
    companyName: "Acme",
    packageUnit: "LPA",
    package: 10,
    placementType: "FTE",
    registrationEnd: new Date("2026-09-01T00:00:00Z"),
    programs: ["CSE", "IT"],
    rawData: { ignored: true },
    ...overrides,
  };
}

describe("canonical hash — deterministic change detection", () => {
  it("same data → same hash", () => {
    expect(canonicalHash(makeOpp())).toBe(canonicalHash(makeOpp()));
  });

  it("ignores key insertion order (canonicalization)", () => {
    const a = makeOpp({ rawData: { a: 1, b: 2 } });
    const b = makeOpp({ rawData: { b: 2, a: 1 } });
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it("changed deadline → different hash", () => {
    const a = canonicalHash(makeOpp());
    const b = canonicalHash(
      makeOpp({ registrationEnd: new Date("2026-10-01T00:00:00Z") }),
    );
    expect(a).not.toBe(b);
  });

  it("changed package → different hash", () => {
    expect(canonicalHash(makeOpp())).not.toBe(canonicalHash(makeOpp({ package: 12 })));
  });

  it("changed eligibility → different hash", () => {
    expect(canonicalHash(makeOpp())).not.toBe(
      canonicalHash(makeOpp({ minimumCgpa: 7.5 })),
    );
  });

  it("changed programs list → different hash", () => {
    expect(canonicalHash(makeOpp())).not.toBe(
      canonicalHash(makeOpp({ programs: ["CSE"] })),
    );
  });

  it("undefined fields are excluded from the hash", () => {
    const a = canonicalHash(makeOpp({ minimumCgpa: undefined }));
    const b = canonicalHash(makeOpp({}));
    expect(a).toBe(b);
  });

  it("rawData does not affect the hash", () => {
    expect(canonicalHash(makeOpp({ rawData: { x: 1 } }))).toBe(
      canonicalHash(makeOpp({ rawData: { totally: "different" } })),
    );
  });

  it("externalId (identity) does not affect the content hash", () => {
    expect(canonicalHash(makeOpp())).toBe(canonicalHash(makeOpp({ externalId: "2" })));
  });
});
