/**
 * Notification contracts (M10). Channels render and deliver digests; the
 * service only decides WHAT to send. Adding Telegram/SMS later means
 * implementing this interface — the sync pipeline stays untouched.
 *
 * Privacy: digests carry placement data only — never student personal data.
 */

import type { Logger } from "../logger.js";

export interface DigestOpportunity {
  externalId: string;
  companyName: string;
  packageLpa?: number | null;
  placementType?: string | null;
  registrationEnd?: Date | null;
  minimumCgpa?: number | null;
  sscPercentage?: number | null;
  hscPercentage?: number | null;
  description?: string | null;
}

export interface DigestFieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface DigestUpdate {
  externalId: string;
  companyName: string;
  packageLpa?: number | null;
  registrationEnd?: Date | null;
  fieldChanges: DigestFieldChange[];
}

export interface DigestRunInfo {
  syncRunId: number;
  durationMs: number;
}

export interface NotificationDigest {
  run: DigestRunInfo;
  newOpportunities: DigestOpportunity[];
  updatedOpportunities: DigestUpdate[];
}

export interface NotificationChannel {
  readonly name: string;
  send(digest: NotificationDigest, log?: Logger): Promise<void>;
}

export function isEmptyDigest(digest: NotificationDigest): boolean {
  return (
    digest.newOpportunities.length === 0 &&
    digest.updatedOpportunities.length === 0
  );
}
