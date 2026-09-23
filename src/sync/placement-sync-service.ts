import { Prisma, type PrismaClient } from "@prisma/client";
import type { Logger } from "../logger.js";
import type { TpoClient } from "../tpo/client.js";
import type { RawAttachment } from "../tpo/schemas.js";
import { applyDetails, normalizeList } from "../placement/normalize.js";
import { canonicalHash } from "../placement/canonical.js";

/** Attachments collaborator (M8) — optional so the sync core stays testable. */
export interface AttachmentSync {
  syncFor(opportunityId: number, externalId: string, raw: RawAttachment[]): Promise<void>;
}

/** Prisma Json columns reject `unknown` — narrow explicitly. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/** Strip undefined values so create/update inputs build cleanly with exactOptionalPropertyTypes. */
function omitUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Deterministic synchronization engine. No LLM involved.
 *
 * Flow: fetch list → normalize → upsert by externalId → detect changes via
 * canonical SHA-256 → record PlacementChange. Details are fetched only for
 * new or changed opportunities (metadata-first principle).
 *
 * Per-item error isolation: one failing opportunity never aborts the run.
 */

export interface SyncSummary {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  durationMs: number;
  syncRunId: number;
}

interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export class PlacementSyncService {
  constructor(
    private readonly client: TpoClient,
    private readonly db: PrismaClient,
    private readonly log: Logger,
    private readonly attachments?: AttachmentSync,
  ) {}

  async run(): Promise<SyncSummary> {
    const startedAt = Date.now();
    const syncRun = await this.db.syncRun.create({ data: { status: "running" } });
    const summary: SyncSummary = {
      fetched: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      durationMs: 0,
      syncRunId: syncRun.id,
    };

    this.log.info({ syncRunId: syncRun.id }, "SYNC START");

    try {
      const listPayload = await this.client.getCompanyOfferings();
      const opportunities = normalizeList(listPayload);
      summary.fetched = opportunities.length;
      this.log.info({ fetched: opportunities.length }, "list fetched and normalized");

      const externalIds = opportunities.map((o) => o.externalId);
      const existing = await this.db.placementOpportunity.findMany({
        where: { externalId: { in: externalIds } },
      });
      const existingById = new Map(existing.map((e) => [e.externalId, e]));

      for (const opp of opportunities) {
        const known = existingById.get(opp.externalId);
        try {
          // Details are fetched every run: the portal list is small and
          // detail-level changes (criteria, stipend, description) are only
          // visible in the details payload. Hash comparison stays metadata-first:
          // only records whose canonical hash changed are rewritten.
          const full = await this.fetchFull(opp);
          const newHash = canonicalHash(full);
          if (!known) {
            await this.createOpportunity(full, newHash);
            summary.created += 1;
          } else if (newHash !== known.contentHash) {
            await this.updateOpportunity(known.id, known, full, newHash);
            summary.updated += 1;
          } else {
            await this.db.placementOpportunity.update({
              where: { id: known.id },
              data: { lastSeenAt: new Date() },
            });
            summary.unchanged += 1;
          }
        } catch (err) {
          // Per-item error isolation: record, continue.
          summary.failed += 1;
          this.log.error(
            { externalId: opp.externalId, err: String(err) },
            "opportunity sync failed (continuing)",
          );
        }
      }

      summary.durationMs = Date.now() - startedAt;
      await this.db.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "success",
          finishedAt: new Date(),
          fetched: summary.fetched,
          created: summary.created,
          updated: summary.updated,
          unchanged: summary.unchanged,
          failed: summary.failed,
          durationMs: summary.durationMs,
        },
      });
      this.log.info({ ...summary }, "SYNC COMPLETE");
      return summary;
    } catch (err) {
      summary.durationMs = Date.now() - startedAt;
      await this.db.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          fetched: summary.fetched,
          created: summary.created,
          updated: summary.updated,
          unchanged: summary.unchanged,
          failed: summary.failed,
          durationMs: summary.durationMs,
          error: String(err),
        },
      });
      this.log.error({ err: String(err) }, "SYNC FAILED");
      throw err;
    }
  }

  /** Fetch details and merge into the list-level record; falls back to list-level on failure. */
  private async fetchFull(opp: Awaited<ReturnType<typeof normalizeList>>[number]) {
    try {
      const details = await this.client.getCompanyOfferingDetails(Number(opp.externalId));
      return applyDetails(opp, details);
    } catch (err) {
      this.log.warn(
        { externalId: opp.externalId, err: String(err) },
        "details unavailable; using list-level record",
      );
      return opp;
    }
  }

  /** Persist a brand-new opportunity. */
  private async createOpportunity(
    full: Awaited<ReturnType<typeof normalizeList>>[number],
    contentHash: string,
  ): Promise<void> {
    const created = await this.db.placementOpportunity.create({
      data: omitUndefined({
        externalId: full.externalId,
        companyName: full.companyName,
        offeringCode: full.offeringCode,
        packageLpa: full.package,
        minPackageLpa: full.minPackage,
        placementType: full.placementType,
        internshipType: full.internshipType,
        companyType: full.companyType,
        academicYear: full.academicYear,
        registrationStart: full.registrationStart,
        registrationEnd: full.registrationEnd,
        minimumCgpa: full.minimumCgpa,
        sscPercentage: full.sscPercentage,
        hscPercentage: full.hscPercentage,
        diplomaPercentage: full.diplomaPercentage,
        activeBacklogsAllowed: full.activeBacklogsAllowed,
        deadBacklogsAllowed: full.deadBacklogsAllowed,
        placedStudentsAllowed: full.placedStudentsAllowed,
        yearDownAllowed: full.yearDownAllowed,
        higherStudiesAllowed: full.higherStudiesAllowed,
        programs: full.programs ?? [],
        graduationYears: full.graduationYears ?? [],
        organizations: full.organizations ?? [],
        skills: full.skills ?? [],
        locations: full.locations ?? [],
        minStipend: full.minStipend,
        maxStipend: full.maxStipend,
        stipendDescription: full.stipendDescription,
        description: full.description,
        jobDescription: full.jobDescription,
        bondDescription: full.bondDescription,
        selectionProcess: full.selectionProcess ?? [],
        isActive: full.isActive,
        contentHash,
        rawData: toJson(full.rawData),
      }) as Prisma.PlacementOpportunityUncheckedCreateInput,
    });
    await this.db.placementRequirement.upsert({
      where: { opportunityId: created.id },
      create: { opportunityId: created.id, criteria: toJson(extractCriteria(full.rawData)) },
      update: { criteria: toJson(extractCriteria(full.rawData)) },
    });
    await this.db.placementChange.create({
      data: {
        opportunityId: created.id,
        externalId: full.externalId,
        type: "new",
        newHash: contentHash,
      },
    });
    this.log.info({ externalId: full.externalId, company: full.companyName }, "🆕 new placement stored");
    await this.syncAttachmentsFor(created.id, full.externalId);
  }

  /** Update an existing opportunity whose canonical hash changed. */
  private async updateOpportunity(
    id: number,
    known: { contentHash: string | null },
    full: Awaited<ReturnType<typeof normalizeList>>[number],
    contentHash: string,
  ): Promise<void> {
    const before = await this.db.placementOpportunity.findUniqueOrThrow({ where: { id } });

    const fieldChanges = diffRecords(
      {
        companyName: before.companyName,
        packageLpa: before.packageLpa,
        minPackageLpa: before.minPackageLpa,
        placementType: before.placementType,
        registrationStart: before.registrationStart?.toISOString(),
        registrationEnd: before.registrationEnd?.toISOString(),
        minimumCgpa: before.minimumCgpa,
        sscPercentage: before.sscPercentage,
        hscPercentage: before.hscPercentage,
        diplomaPercentage: before.diplomaPercentage,
        activeBacklogsAllowed: before.activeBacklogsAllowed,
        deadBacklogsAllowed: before.deadBacklogsAllowed,
        description: before.description,
      },
      {
        companyName: full.companyName,
        packageLpa: full.package,
        minPackageLpa: full.minPackage,
        placementType: full.placementType,
        registrationStart: full.registrationStart?.toISOString(),
        registrationEnd: full.registrationEnd?.toISOString(),
        minimumCgpa: full.minimumCgpa,
        sscPercentage: full.sscPercentage,
        hscPercentage: full.hscPercentage,
        diplomaPercentage: full.diplomaPercentage,
        activeBacklogsAllowed: full.activeBacklogsAllowed,
        deadBacklogsAllowed: full.deadBacklogsAllowed,
        description: full.description,
      },
    );

    await this.db.placementOpportunity.update({
      where: { id },
      data: omitUndefined({
        externalId: full.externalId,
        companyName: full.companyName,
        offeringCode: full.offeringCode,
        packageLpa: full.package,
        minPackageLpa: full.minPackage,
        placementType: full.placementType,
        internshipType: full.internshipType,
        companyType: full.companyType,
        academicYear: full.academicYear,
        registrationStart: full.registrationStart,
        registrationEnd: full.registrationEnd,
        minimumCgpa: full.minimumCgpa,
        sscPercentage: full.sscPercentage,
        hscPercentage: full.hscPercentage,
        diplomaPercentage: full.diplomaPercentage,
        activeBacklogsAllowed: full.activeBacklogsAllowed,
        deadBacklogsAllowed: full.deadBacklogsAllowed,
        placedStudentsAllowed: full.placedStudentsAllowed,
        yearDownAllowed: full.yearDownAllowed,
        higherStudiesAllowed: full.higherStudiesAllowed,
        programs: full.programs ?? [],
        graduationYears: full.graduationYears ?? [],
        organizations: full.organizations ?? [],
        skills: full.skills ?? [],
        locations: full.locations ?? [],
        minStipend: full.minStipend,
        maxStipend: full.maxStipend,
        stipendDescription: full.stipendDescription,
        description: full.description,
        jobDescription: full.jobDescription,
        bondDescription: full.bondDescription,
        selectionProcess: full.selectionProcess ?? [],
        isActive: full.isActive,
        contentHash,
        rawData: toJson(full.rawData),
      }) as Prisma.PlacementOpportunityUncheckedUpdateInput,
    });

    await this.db.placementRequirement.upsert({
      where: { opportunityId: id },
      create: { opportunityId: id, criteria: toJson(extractCriteria(full.rawData)) },
      update: { criteria: toJson(extractCriteria(full.rawData)) },
    });

    await this.db.placementChange.create({
      data: {
        opportunityId: id,
        externalId: full.externalId,
        type: "updated",
        previousHash: known.contentHash,
        newHash: contentHash,
        ...(fieldChanges.length > 0 ? { fieldChanges: toJson(fieldChanges) } : {}),
      },
    });
    this.log.info(
      { externalId: full.externalId, fields: fieldChanges.map((f) => f.field) },
      "♻️ placement updated",
    );
    await this.syncAttachmentsFor(id, full.externalId);
  }

  /** Fetch + persist attachments for a new/changed opportunity (M8). */
  private async syncAttachmentsFor(
    opportunityId: number,
    externalId: string,
  ): Promise<void> {
    if (!this.attachments) return;
    try {
      const raw = await this.client.getAttachments(Number(externalId));
      await this.attachments.syncFor(opportunityId, externalId, raw);
    } catch (err) {
      this.log.warn(
        { externalId, err: String(err) },
        "attachment sync unavailable (continuing)",
      );
    }
  }
}

function diffRecords(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const key of Object.keys(after)) {
    const b = before[key];
    const a = after[key];
    if (JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)) {
      changes.push({ field: key, from: b ?? null, to: a ?? null });
    }
  }
  return changes;
}

function extractCriteria(rawData: unknown): unknown {
  if (
    rawData !== null &&
    typeof rawData === "object" &&
    Array.isArray((rawData as Record<string, unknown>).criteria)
  ) {
    return (rawData as Record<string, unknown>).criteria;
  }
  return [];
}
