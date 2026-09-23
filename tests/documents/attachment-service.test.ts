import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rm, readFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../../src/logger.js";
import { prisma } from "../../src/database/client.js";
import { AttachmentService } from "../../src/documents/attachment-service.js";
import { AiClient } from "../../src/ai/client.js";
import { PlacementAIService } from "../../src/ai/placement-ai-service.js";
import { makeTestPdf } from "../helpers/test-pdf.js";
import type { RawAttachment } from "../../src/tpo/schemas.js";
import type { PlacementExtraction } from "../../src/ai/schema.js";

/**
 * Integration tests against the local dev database with a mocked fetch
 * (no network). Documents are stored under a temporary root; test data
 * is cleaned up afterwards.
 */

const OPP_EXTERNAL_ID = "9401";

const PDF_BYTES = makeTestPdf([
  "Hello Placement Intelligence",
  "CGPA >= 7.5 required",
]);

// Long enough to pass the AI service's minimum-text gate.
const NOTICE_PDF_BYTES = makeTestPdf([
  "BMC Software internship plus PPO for the graduating batch 2028.",
  "Eligibility: minimum CGPA 7.5, SSC 70% and HSC 70%.",
  "No active backlogs allowed. CTC 16 LPA, stipend 40000.",
  "Last date to apply: 2026-08-17.",
]);

function rawAttachment(overrides: Partial<RawAttachment> = {}): RawAttachment {
  return {
    id: 9501,
    filename: "Details of Role 01 Jan 2026.pdf",
    filepath: "Company_Attachments/VIT/Corp/2026-27/att1pdf",
    fileUrl: "https://bucket.s3.example.com/key?X-Amz-Signature=abc",
    ...overrides,
  } as RawAttachment;
}

const GOOD_EXTRACTION: PlacementExtraction = {
  role: "Internship + PPO",
  minimumCgpa: 7.5,
  sscPercentage: 70,
  hscPercentage: 70,
  diplomaPercentage: null,
  allowedBranches: [],
  graduationYears: [2028],
  backlogPolicy: "no_active_backlogs",
  skills: [],
  locations: [],
  salary: "16 LPA",
  stipend: "40000",
  deadline: "2026-08-17",
  selectionStages: ["Aptitude", "Technical Interview", "HR Interview"],
  confidence: "high",
  notes: [],
};

function aiFetchAi(
  payload: unknown,
): typeof globalThis.fetch {
  if (payload instanceof Error) {
    return (async () => {
      throw payload;
    }) as unknown as typeof globalThis.fetch;
  }
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof globalThis.fetch;
}

function makeFetch(
  respond: () => Response | Error,
  calls?: string[],
): typeof globalThis.fetch {
  return (async (url: string | URL | Request) => {
    calls?.push(String(url));
    const result = respond();
    if (result instanceof Error) throw result;
    return result;
  }) as unknown as typeof globalThis.fetch;
}

const pdfResponse = (): Response =>
  new Response(PDF_BYTES.slice(), {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });

describe("AttachmentService (integration, mocked download)", () => {
  let rootDir: string;
  let opportunityId: number;
  let fetchCalls: string[];
  let service: AttachmentService;

  beforeEach(async () => {
    rootDir = path.join("var", "attachments-test");
    fetchCalls = [];
    await rm(rootDir, { recursive: true, force: true });

    const opp = await prisma.placementOpportunity.create({
      data: {
        externalId: OPP_EXTERNAL_ID,
        companyName: "AttachTestCorp",
        contentHash: "hash",
        rawData: {},
      },
    });
    opportunityId = opp.id;

    const response = new Response(PDF_BYTES.slice(), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
    service = new AttachmentService(
      prisma,
      logger,
      makeFetch(pdfResponse, fetchCalls),
      rootDir,
    );
  });

  afterEach(async () => {
    await prisma.placementAttachment.deleteMany({
      where: { opportunityId },
    });
    await prisma.placementOpportunity.deleteMany({
      where: { externalId: OPP_EXTERNAL_ID },
    });
    await rm(rootDir, { recursive: true, force: true });
  });

  it("downloads a PDF, stores the file, hash and extracted text", async () => {
    await service.syncFor(opportunityId, OPP_EXTERNAL_ID, [rawAttachment()]);

    const row = await prisma.placementAttachment.findUnique({
      where: { opportunityId_externalId: { opportunityId, externalId: "9501" } },
    });
    expect(row?.downloadedAt).toBeTruthy();
    expect(row?.localPath).toBeTruthy();
    expect(row?.objectKey).toBe("Company_Attachments/VIT/Corp/2026-27/att1pdf");
    expect(row?.extractedText).toContain("Hello Placement Intelligence");
    expect(row?.extractedText).toContain("CGPA >= 7.5 required");

    const stored = await readFile(row!.localPath!);
    expect(stored.byteLength).toBe(PDF_BYTES.byteLength);
    // The signed URL must never be persisted anywhere in the row.
    expect(JSON.stringify(row)).not.toContain("X-Amz-Signature");
  });

  it("is idempotent: a stored file is not downloaded twice", async () => {
    await service.syncFor(opportunityId, OPP_EXTERNAL_ID, [rawAttachment()]);
    await service.syncFor(opportunityId, OPP_EXTERNAL_ID, [rawAttachment()]);
    expect(fetchCalls).toHaveLength(1);

    const count = await prisma.placementAttachment.count({
      where: { opportunityId },
    });
    expect(count).toBe(1);
  });

  it("re-downloads when the local file went missing and a fresh URL exists", async () => {
    await service.syncFor(opportunityId, OPP_EXTERNAL_ID, [rawAttachment()]);
    const row = await prisma.placementAttachment.findUnique({
      where: { opportunityId_externalId: { opportunityId, externalId: "9501" } },
    });
    await rm(row!.localPath!);

    await service.syncFor(opportunityId, OPP_EXTERNAL_ID, [rawAttachment()]);
    expect(fetchCalls).toHaveLength(2);
    const again = await prisma.placementAttachment.findUnique({
      where: { opportunityId_externalId: { opportunityId, externalId: "9501" } },
    });
    expect(again?.downloadedAt!.getTime()).toBeGreaterThanOrEqual(
      row!.downloadedAt!.getTime(),
    );
  });

  it("stores metadata only when no file URL is available", async () => {
    await service.syncFor(opportunityId, OPP_EXTERNAL_ID, [
      rawAttachment({ fileUrl: null }),
    ]);
    const row = await prisma.placementAttachment.findUnique({
      where: { opportunityId_externalId: { opportunityId, externalId: "9501" } },
    });
    expect(row?.filename).toBeTruthy();
    expect(row?.downloadedAt).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  it("survives a failed download: metadata row, no local file, no throw", async () => {
    const failing = new AttachmentService(
      prisma,
      logger,
      makeFetch(() => new Error("network down"), fetchCalls),
      rootDir,
    );
    await failing.syncFor(opportunityId, OPP_EXTERNAL_ID, [rawAttachment()]);
    const row = await prisma.placementAttachment.findUnique({
      where: { opportunityId_externalId: { opportunityId, externalId: "9501" } },
    });
    expect(row?.filename).toBeTruthy();
    expect(row?.downloadedAt).toBeNull();
    expect(fetchCalls).toHaveLength(1);
  });

  it("stores a non-PDF without text extraction", async () => {
    const nonPdf = new AttachmentService(
      prisma,
      logger,
      makeFetch(
        () => new Response(new TextEncoder().encode("not a pdf"), { status: 200 }),
      ),
      rootDir,
    );
    await nonPdf.syncFor(opportunityId, OPP_EXTERNAL_ID, [rawAttachment()]);
    const row = await prisma.placementAttachment.findUnique({
      where: { opportunityId_externalId: { opportunityId, externalId: "9501" } },
    });
    expect(row?.downloadedAt).toBeTruthy();
    expect(row?.extractedText).toBeNull();
  });

  it("rejects oversized downloads but keeps the metadata row", async () => {
    const huge = new AttachmentService(
      prisma,
      logger,
      makeFetch(() => new Response(new Uint8Array(21 * 1024 * 1024), { status: 200 })),
      rootDir,
    );
    await huge.syncFor(opportunityId, OPP_EXTERNAL_ID, [
      rawAttachment({ id: 9601, filename: "big.pdf" }),
    ]);
    const row = await prisma.placementAttachment.findUnique({
      where: { opportunityId_externalId: { opportunityId, externalId: "9601" } },
    });
    expect(row?.downloadedAt).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  it("persists verified AI extraction with provenance after PDF text", async () => {
    const aiClient = new AiClient(
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "k",
        model: "test-model",
        fetchFn: aiFetchAi(
          { choices: [{ message: { content: JSON.stringify(GOOD_EXTRACTION) } }] },
        ),
      },
      logger,
    );
    const aiSvc = new PlacementAIService(aiClient, logger);
    const withAi = new AttachmentService(
      prisma,
      logger,
      makeFetch(() => new Response(NOTICE_PDF_BYTES.slice(), { status: 200 }), fetchCalls),
      rootDir,
      aiSvc,
    );

    await withAi.syncFor(opportunityId, OPP_EXTERNAL_ID, [
      rawAttachment({ id: 9801, filename: "notice.pdf" }),
    ]);

    const row = await prisma.placementAttachment.findUnique({
      where: { opportunityId_externalId: { opportunityId, externalId: "9801" } },
    });
    expect(row?.aiModel).toBe("test-model");
    expect(row?.aiExtractedAt).toBeTruthy();
    const data = row?.aiExtraction as { minimumCgpa: number };
    expect(data.minimumCgpa).toBe(7.5);
  });

  it("stores the row without AI fields when extraction fails", async () => {
    const aiClient = new AiClient(
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "k",
        model: "test-model",
        fetchFn: aiFetchAi(new Error("ai down")),
      },
      logger,
    );
    const aiSvc = new PlacementAIService(aiClient, logger);
    const withAi = new AttachmentService(
      prisma,
      logger,
      makeFetch(() => new Response(NOTICE_PDF_BYTES.slice(), { status: 200 }), fetchCalls),
      rootDir,
      aiSvc,
    );

    await withAi.syncFor(opportunityId, OPP_EXTERNAL_ID, [
      rawAttachment({ id: 9811, filename: "notice.pdf" }),
    ]);

    const row = await prisma.placementAttachment.findUnique({
      where: { opportunityId_externalId: { opportunityId, externalId: "9811" } },
    });
    expect(row?.downloadedAt).toBeTruthy();
    expect(row?.extractedText).toContain("minimum CGPA 7.5");
    expect(row?.aiExtraction).toBeNull();
    expect(row?.aiModel).toBeNull();
  });

  it("one failing attachment does not block the rest", async () => {    let n = 0;
    const mixedFetch = makeFetch(() => {
      n += 1;
      if (n === 1) return new Error("first fails");
      return pdfResponse();
    });
    const mixed = new AttachmentService(prisma, logger, mixedFetch, rootDir);

    await mixed.syncFor(opportunityId, OPP_EXTERNAL_ID, [
      rawAttachment({ id: 9701, filename: "broken.pdf" }),
      rawAttachment({ id: 9702, filename: "good.pdf" }),
    ]);

    const rows = await prisma.placementAttachment.findMany({
      where: { opportunityId },
    });
    expect(rows).toHaveLength(2);
    const broken = rows.find((r) => r.externalId === "9701");
    expect(broken?.downloadedAt).toBeNull();
    const good = rows.find((r) => r.externalId === "9702");
    expect(good?.downloadedAt).toBeTruthy();
    expect(good?.extractedText).toContain("Hello Placement Intelligence");
  });
});
