import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../logger.js";
import {
  isEmptyDigest,
  type DigestFieldChange,
  type NotificationChannel,
  type NotificationDigest,
} from "./types.js";

/**
 * NotificationService (M10): turns placement changes recorded during a sync
 * run into a digest and dispatches it to every configured channel.
 *
 * Failures are isolated: one broken channel never blocks the others or the
 * sync pipeline. Channels are notified even in DRY_RUN (they decide how to
 * behave — the email channel logs a preview instead of sending).
 */

export interface NotifyScope {
  /** Restrict the digest to these opportunity externalIds (e.g. a student's matches). */
  externalIds?: string[];
}

export class NotificationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly log: Logger,
    private readonly channels: NotificationChannel[],
  ) {}

  /**
   * Build and dispatch a digest for changes detected since `since`
   * (typically the sync run's start time). Returns true when a digest
   * was dispatched to at least one channel.
   */
  async notifySince(since: Date, scope?: NotifyScope): Promise<boolean> {
    const changes = await this.db.placementChange.findMany({
      where: {
        detectedAt: { gte: since },
        ...(scope?.externalIds ? { externalId: { in: scope.externalIds } } : {}),
      },
      include: { opportunity: true },
      orderBy: { detectedAt: "asc" },
    });
    if (changes.length === 0) {
      this.log.debug("no new placement changes; nothing to notify");
      return false;
    }
    const newOpps = new Map<string, (typeof changes)[number]["opportunity"]>();
    const updates = new Map<
      string,
      {
        opportunity: (typeof changes)[number]["opportunity"];
        fieldChanges: DigestFieldChange[];
      }
    >();

    for (const change of changes) {
      if (change.type === "new") {
        newOpps.set(change.externalId, change.opportunity);
      } else if (change.type === "updated") {
        const entry = updates.get(change.externalId) ?? {
          opportunity: change.opportunity,
          fieldChanges: [],
        };
        const raw = change.fieldChanges as DigestFieldChange[] | null;
        if (Array.isArray(raw)) entry.fieldChanges.push(...raw);
        updates.set(change.externalId, entry);
      }
      // "removed"/future types: nothing to render yet.
    }

    const digest: NotificationDigest = {
      run: { syncRunId: 0, durationMs: 0 },
      newOpportunities: [...newOpps.values()].map((o) => ({
        externalId: o.externalId,
        companyName: o.companyName,
        packageLpa: o.packageLpa,
        placementType: o.placementType,
        registrationEnd: o.registrationEnd,
        minimumCgpa: o.minimumCgpa,
        sscPercentage: o.sscPercentage,
        hscPercentage: o.hscPercentage,
        description: o.description,
      })),
      updatedOpportunities: [...updates.values()].map((u) => ({
        externalId: u.opportunity.externalId,
        companyName: u.opportunity.companyName,
        packageLpa: u.opportunity.packageLpa,
        registrationEnd: u.opportunity.registrationEnd,
        fieldChanges: u.fieldChanges,
      })),
    };

    if (isEmptyDigest(digest)) return false;

    let dispatched = false;
    for (const channel of this.channels) {
      try {
        await channel.send(digest, this.log);
        dispatched = true;
      } catch (err) {
        this.log.error(
          { channel: channel.name, err: String(err) },
          "notification channel failed (continuing)",
        );
      }
    }

    if (dispatched) {
      await this.db.placementChange.updateMany({
        where: { id: { in: changes.map((c) => c.id) } },
        data: { notifiedAt: new Date() },
      });
    }
    return dispatched;
  }
}
