import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/logger.js";
import type { TpoClient } from "../../src/tpo/client.js";
import { prisma } from "../../src/database/client.js";
import { PlacementSyncService, type SyncSummary } from "../../src/sync/placement-sync-service.js";

/**
 * Integration tests for the sync engine against the local dev database,
 * using a mocked TpoClient (no live calls). Test data is cleaned up.
 */

const TEST_IDS = ["9001", "9002"];

function rawListEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 9001,
    company: "TestCorp A",
    maxPackage: 10,
    minPackage: 8,
    placementtype: "FTE",
    regStartdatenew: "2026-08-01T00:00:00Z",
    regEnddatenew: "2026-08-30T00:00:00Z",
    isactive: true,
    programnew: [null, "BTech CSE"],
    organization: ["VIT"],
    skill: [],
    ...overrides,
  };
}

function rawDetails(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    msg: "200",
    code: "TEST1",
    company_name: "TestCorp A",
    criteria: [
      { degree: "SSC", percentage: 70, program: "All" },
      { degree: "Graduation", percentage: 7.5, program: "All" },
    ],
    selction_procedure: [{ round_number: 1, companyround: "Aptitude", isfinal: false }],
    programlist: [{ org: "VIT", year: null, program: "BTech CSE" }],
    is_live_backlog_allowed: false,
    is_dead_backlog_allowed: false,
    minstipend: 20000,
    maxstipend: 25000,
    description: "Great role",
    locations: ["Pune"],
    ...overrides,
  };
}

interface MockState {
  listPayload: unknown[];
  detailFor: Record<number, unknown>;
  failDetailsFor: Set<number>;
}

function makeClient(state: MockState): TpoClient {
  return {
    getCompanyOfferings: async () => ({ status: "200", company_list: state.listPayload }),
    getCompanyOfferingDetails: async (offeringId: number) => {
      if (state.failDetailsFor.has(offeringId)) {
        throw new Error("simulated details failure");
      }
      return state.detailFor[offeringId];
    },
    getAttachments: async () => [],
  } as unknown as TpoClient;
}

async function cleanupTestData(): Promise<void> {
  await prisma.placementChange.deleteMany({
    where: { externalId: { in: TEST_IDS } },
  });
  await prisma.placementRequirement.deleteMany({
    where: { opportunity: { externalId: { in: TEST_IDS } } },
  });
  await prisma.placementOpportunity.deleteMany({
    where: { externalId: { in: TEST_IDS } },
  });
  await prisma.syncRun.deleteMany({ where: { id: { gt: 0 } } });
}

describe("PlacementSyncService (integration, mocked API)", () => {
  let state: MockState;
  let service: PlacementSyncService;

  beforeEach(async () => {
    await cleanupTestData();
    state = {
      listPayload: [rawListEntry()],
      detailFor: { 9001: rawDetails() },
      failDetailsFor: new Set(),
    };
    service = new PlacementSyncService(makeClient(state), prisma, logger);
  });

  afterEach(cleanupTestData);

  it("first run creates everything and records 'new' changes", async () => {
    const summary = await service.run();
    expect(summary.fetched).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(0);
    expect(summary.failed).toBe(0);

    const opp = await prisma.placementOpportunity.findUnique({
      where: { externalId: "9001" },
      include: { requirements: true },
    });
    expect(opp?.companyName).toBe("TestCorp A");
    expect(opp?.minimumCgpa).toBe(7.5);
    expect(opp?.contentHash).toBeTruthy();
    expect(opp?.requirements).toBeTruthy();

    const change = await prisma.placementChange.findFirst({
      where: { externalId: "9001" },
    });
    expect(change?.type).toBe("new");
  });

  it("second run with identical data is fully idempotent", async () => {
    await service.run();
    const second: SyncSummary = await service.run();
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);

    const count = await prisma.placementOpportunity.count({
      where: { externalId: "9001" },
    });
    expect(count).toBe(1);
  });

  it("deadline change is detected with field-level diff", async () => {
    await service.run();
    state.listPayload = [
      rawListEntry({ regEnddatenew: "2026-09-15T00:00:00Z" }),
    ];
    const summary = await service.run();
    expect(summary.updated).toBe(1);

    const change = await prisma.placementChange.findFirst({
      where: { externalId: "9001", type: "updated" },
      orderBy: { detectedAt: "desc" },
    });
    expect(change?.previousHash).toBeTruthy();
    expect(change?.newHash).toBeTruthy();
    const fields = (change?.fieldChanges as Array<{ field: string }>) ?? [];
    expect(fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "registrationEnd" })]),
    );
  });

  it("package change is detected", async () => {
    await service.run();
    state.listPayload = [rawListEntry({ maxPackage: 14 })];
    const summary = await service.run();
    expect(summary.updated).toBe(1);
    const change = await prisma.placementChange.findFirst({
      where: { externalId: "9001", type: "updated" },
      orderBy: { detectedAt: "desc" },
    });
    const fields = (change?.fieldChanges as Array<{ field: string; to: unknown }>) ?? [];
    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "packageLpa", to: 14 }),
      ]),
    );
  });

  it("eligibility change (list-level) is detected", async () => {
    await service.run();
    state.listPayload = [rawListEntry({ placementtype: "Internship + PPO" })];
    const summary = await service.run();
    expect(summary.updated).toBe(1);
  });

  it("one failing details call does not abort the run", async () => {
    state.listPayload = [rawListEntry(), rawListEntry({ id: 9002, company: "TestCorp B" })];
    state.detailFor[9002] = rawDetails({ company_name: "TestCorp B" });
    state.failDetailsFor.add(9002);

    const summary = await service.run();
    expect(summary.fetched).toBe(2);
    expect(summary.created).toBe(2);
    expect(summary.failed).toBe(0);

    // 9002 stored at list level despite details failure
    const b = await prisma.placementOpportunity.findUnique({
      where: { externalId: "9002" },
    });
    expect(b?.companyName).toBe("TestCorp B");
    expect(b?.minimumCgpa).toBeNull();
  });

  it("records SyncRun metadata", async () => {
    await service.run();
    const run = await prisma.syncRun.findFirst({ orderBy: { id: "desc" } });
    expect(run?.status).toBe("success");
    expect(run?.fetched).toBe(1);
    expect(run?.created).toBe(1);
    expect(run?.finishedAt).toBeTruthy();
    expect(run?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("failed runs are recorded with error details", async () => {
    const failingClient = {
      getCompanyOfferings: async () => {
        throw new Error("list call exploded");
      },
    } as unknown as TpoClient;
    const failingService = new PlacementSyncService(failingClient, prisma, logger);
    await expect(failingService.run()).rejects.toThrow("list call exploded");
    const run = await prisma.syncRun.findFirst({ orderBy: { id: "desc" } });
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("list call exploded");
  });

  it("passes new opportunities to the attachments collaborator (M8)", async () => {
    const syncFor = vi.fn(async () => {});
    const withAtt = new PlacementSyncService(makeClient(state), prisma, logger, {
      syncFor,
    });
    await withAtt.run();
    expect(syncFor).toHaveBeenCalledWith(
      expect.any(Number),
      "9001",
      expect.any(Array),
    );
  });

  it("an attachment collaborator failure does not fail the run", async () => {
    const syncFor = vi.fn(async () => {
      throw new Error("attachment pipeline broken");
    });
    const withAtt = new PlacementSyncService(makeClient(state), prisma, logger, {
      syncFor,
    });
    const summary = await withAtt.run();
    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(0);
  });
});
