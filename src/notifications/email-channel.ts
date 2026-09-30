import nodemailer, { type Transporter } from "nodemailer";
import { loadEnv } from "../config/env.js";
import type { Logger } from "../logger.js";
import {
  isEmptyDigest,
  type DigestFieldChange,
  type NotificationChannel,
  type NotificationDigest,
} from "./types.js";

/**
 * EmailChannel (M10): formatted HTML + plain-text digest via SMTP.
 * Sending is suppressed in DRY_RUN (the digest is logged instead so
 * behavior is always verifiable).
 */

const FIELD_LABELS: Record<string, string> = {
  companyName: "Company",
  packageLpa: "Package (LPA)",
  minPackageLpa: "Min package (LPA)",
  placementType: "Placement type",
  registrationStart: "Registration start",
  registrationEnd: "Registration deadline",
  minimumCgpa: "Minimum CGPA",
  sscPercentage: "SSC %",
  hscPercentage: "HSC %",
  diplomaPercentage: "Diploma %",
  activeBacklogsAllowed: "Active backlogs allowed",
  deadBacklogsAllowed: "Dead backlogs allowed",
  description: "Description",
};

function labelFor(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value instanceof Object) return JSON.stringify(value);
  return String(value);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function deadlineLine(opp: { registrationEnd?: Date | null }): string {
  if (!opp.registrationEnd) return "";
  const days = Math.ceil(
    (opp.registrationEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );
  const when = opp.registrationEnd.toISOString().slice(0, 10);
  return days >= 0 ? `\nDeadline: ${when} (${days} day(s) left)` : `\nDeadline: ${when} (passed)`;
}

function eligibilityLine(opp: {
  minimumCgpa?: number | null;
  sscPercentage?: number | null;
  hscPercentage?: number | null;
}): string {
  const parts: string[] = [];
  if (opp.minimumCgpa != null) parts.push(`CGPA ≥ ${opp.minimumCgpa}`);
  if (opp.sscPercentage != null) parts.push(`SSC ≥ ${opp.sscPercentage}%`);
  if (opp.hscPercentage != null) parts.push(`HSC ≥ ${opp.hscPercentage}%`);
  return parts.length > 0 ? `\nEligibility: ${parts.join(", ")}` : "";
}

export interface EmailConfig {
  to: string;
  from: string;
  dryRun: boolean;
  transporter: Transporter | undefined;
}

export class EmailChannel implements NotificationChannel {
  readonly name = "email";

  private readonly config: EmailConfig;

  private constructor(config: EmailConfig) {
    this.config = config;
  }

  /** Build from environment (production wiring). */
  static fromEnv(): EmailChannel | undefined {
    const env = loadEnv();
    if (!env.NOTIFY_EMAIL_TO) return undefined;
    const transporter =
      env.SMTP_HOST && env.SMTP_PORT
        ? nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_PORT === 465,
            auth:
              env.SMTP_USER && env.SMTP_PASS
                ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
                : undefined,
          })
        : undefined;
    return new EmailChannel({
      to: env.NOTIFY_EMAIL_TO,
      from: env.SMTP_USER || "placement-intel@localhost",
      dryRun: env.DRY_RUN,
      transporter,
    });
  }

  /** Test wiring with explicit config. */
  static forTest(config: Partial<EmailConfig>): EmailChannel {
    return new EmailChannel({
      to: config.to ?? "student@example.com",
      from: config.from ?? "placement-intel@test",
      dryRun: config.dryRun ?? false,
      transporter: config.transporter,
    });
  }

  get configured(): boolean {
    return this.config.transporter !== undefined;
  }

  async send(digest: NotificationDigest, log?: Logger): Promise<void> {
    if (isEmptyDigest(digest)) return;
    if (!this.configured || !this.config.transporter) {
      throw new Error(
        "EmailChannel not configured (set SMTP_HOST/SMTP_PORT and NOTIFY_EMAIL_TO)",
      );
    }

    const subject = this.subject(digest);
    const text = this.renderText(digest);
    const html = this.renderHtml(digest);

    if (this.config.dryRun) {
      log?.info({ subject, to: this.config.to }, "DRY_RUN: would send digest email");
      log?.info({ digest: text }, "DRY_RUN: digest preview");
      return;
    }

    await this.config.transporter.sendMail({
      from: this.config.from,
      to: this.config.to,
      subject,
      text,
      html,
    });
    log?.info({ to: this.config.to, subject }, "digest email sent");
  }

  /** Operational alert (e.g. repeated sync failures) — same transport, plain text. */
  async sendFailureAlert(subject: string, text: string, log?: Logger): Promise<void> {
    if (!this.configured || !this.config.transporter) {
      throw new Error(
        "EmailChannel not configured (set SMTP_HOST/SMTP_PORT and NOTIFY_EMAIL_TO)",
      );
    }
    if (this.config.dryRun) {
      log?.info({ subject, to: this.config.to }, "DRY_RUN: would send failure alert");
      return;
    }
    await this.config.transporter.sendMail({
      from: this.config.from,
      to: this.config.to,
      subject,
      text,
    });
    log?.info({ to: this.config.to, subject }, "failure alert sent");
  }

  private subject(digest: NotificationDigest): string {
    const n = digest.newOpportunities.length;
    const u = digest.updatedOpportunities.length;
    const parts: string[] = [];
    if (n > 0) parts.push(`${n} new`);
    if (u > 0) parts.push(`${u} updated`);
    return `Placement digest: ${parts.join(", ")}`;
  }

  private renderText(digest: NotificationDigest): string {
    const lines: string[] = ["Placement digest", ""];

    if (digest.newOpportunities.length > 0) {
      lines.push("── New opportunities ──");
      for (const opp of digest.newOpportunities) {
        lines.push(
          `🆕 ${opp.companyName}` +
            (opp.placementType ? `\nRole: ${opp.placementType}` : "") +
            (opp.packageLpa != null ? `\nPackage: ${opp.packageLpa} LPA` : "") +
            eligibilityLine(opp) +
            deadlineLine(opp) +
            "\n",
        );
      }
    }

    if (digest.updatedOpportunities.length > 0) {
      lines.push("── Updated opportunities ──");
      for (const upd of digest.updatedOpportunities) {
        lines.push(`♻️ ${upd.companyName}`);
        for (const change of upd.fieldChanges) {
          lines.push(
            `  ${labelFor(change.field)}: ${formatValue(change.from)} → ${formatValue(change.to)}`,
          );
        }
        lines.push(deadlineLine(upd), "");
      }
    }

    lines.push(`Run #${digest.run.syncRunId} completed in ${digest.run.durationMs}ms.`);
    return lines.join("\n");
  }

  private renderHtml(digest: NotificationDigest): string {
    const renderChanges = (changes: DigestFieldChange[]) =>
      changes
        .map(
          (c) =>
            `<li><strong>${escapeHtml(labelFor(c.field))}</strong>: ${escapeHtml(formatValue(c.from))} → ${escapeHtml(formatValue(c.to))}</li>`,
        )
        .join("");

    const newSection =
      digest.newOpportunities.length > 0
        ? `<h2>New opportunities</h2>${digest.newOpportunities
            .map((o) => {
              const eligibility = [
                o.minimumCgpa != null ? `CGPA ≥ ${o.minimumCgpa}` : null,
                o.sscPercentage != null ? `SSC ≥ ${o.sscPercentage}%` : null,
                o.hscPercentage != null ? `HSC ≥ ${o.hscPercentage}%` : null,
              ]
                .filter(Boolean)
                .join(", ");
              return `<p>🆕 <strong>${escapeHtml(o.companyName)}</strong><br/>${escapeHtml(
                [
                  o.placementType,
                  o.packageLpa != null ? `${o.packageLpa} LPA` : null,
                  eligibility,
                ]
                  .filter(Boolean)
                  .join(" · "),
              )}${o.registrationEnd ? `<br/>Deadline: ${o.registrationEnd.toISOString().slice(0, 10)}` : ""}</p>`;
            })
            .join("")}`
        : "";

    const updatedSection =
      digest.updatedOpportunities.length > 0
        ? `<h2>Updated opportunities</h2>${digest.updatedOpportunities
            .map(
              (u) =>
                `<p>♻️ <strong>${escapeHtml(u.companyName)}</strong><ul>${renderChanges(u.fieldChanges)}</ul></p>`,
            )
            .join("")}`
        : "";

    return `<div style="font-family: sans-serif">${newSection}${updatedSection}<p style="color:#888">Run #${digest.run.syncRunId} · ${digest.run.durationMs}ms</p></div>`;
  }
}
