import { describe, expect, it } from "vitest";
import { logger } from "../../src/logger.js";
import { EmailChannel } from "../../src/notifications/email-channel.js";
import { SyncFailureAlerter } from "../../src/notifications/sync-failure-alerter.js";
import type { SentMessage } from "nodemailer";

/**
 * SyncFailureAlerter: throttled operational alerting on consecutive sync
 * failures. Sender is injected — no network, no env mocking.
 */

function alerter(sent: Array<{ subject: string; body: string }>, alertEvery = 3) {
  return new SyncFailureAlerter(
    async (subject, body) => {
      sent.push({ subject, body });
    },
    logger,
    alertEvery,
  );
}

describe("SyncFailureAlerter", () => {
  it("stays silent for isolated failures and alerts on the 3rd consecutive one", async () => {
    const sent: Array<{ subject: string; body: string }> = [];
    const a = alerter(sent);
    const err = new Error("TpoApiError: rejected (code=401)");

    await a.recordFailure(err);
    await a.recordFailure(err);
    expect(sent).toHaveLength(0);

    await a.recordFailure(err);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("3 consecutive sync failures");
    expect(sent[0].body).toContain("npm run login");
  });

  it("repeats every Nth consecutive failure", async () => {
    const sent: Array<{ subject: string; body: string }> = [];
    const a = alerter(sent);
    const err = new Error("db unreachable");

    for (let i = 0; i < 6; i++) await a.recordFailure(err);

    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toContain("6 consecutive sync failures");
    // non-401 errors get the generic log hint, not the login hint
    expect(sent[0].body).toContain("launchd.out.log");
    expect(sent[0].body).not.toContain("npm run login");
  });

  it("a successful run resets the counter", async () => {
    const sent: Array<{ subject: string; body: string }> = [];
    const a = alerter(sent);
    const err = new Error("blip");

    await a.recordFailure(err);
    await a.recordFailure(err);
    a.recordSuccess();
    await a.recordFailure(err);
    await a.recordFailure(err);
    expect(sent).toHaveLength(0);

    await a.recordFailure(err);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("3 consecutive sync failures");
  });

  it("alert-delivery failure never propagates", async () => {
    const a = new SyncFailureAlerter(
      async () => {
        throw new Error("smtp down");
      },
      logger,
      1,
    );
    await expect(a.recordFailure(new Error("sync err"))).resolves.toBeUndefined();
  });

  it("respects a custom threshold", async () => {
    const sent: Array<{ subject: string; body: string }> = [];
    const a = alerter(sent, 2);
    const err = new Error("blip");

    await a.recordFailure(err);
    expect(sent).toHaveLength(0);
    await a.recordFailure(err);
    expect(sent).toHaveLength(1);
  });
});

describe("EmailChannel.sendFailureAlert", () => {
  function fakeTransport(sent: SentMessage[]) {
    return {
      sendMail: async (mail: unknown) => {
        sent.push(mail as SentMessage);
        return {} as SentMessage;
      },
    } as never;
  }

  it("sends a plain-text alert to the configured recipients", async () => {
    const sent: SentMessage[] = [];
    const channel = EmailChannel.forTest({ transporter: fakeTransport(sent) });
    await channel.sendFailureAlert("alert subject", "alert body", logger);

    expect(sent).toHaveLength(1);
    const mail = sent[0] as unknown as { subject: string; text: string };
    expect(mail.subject).toBe("alert subject");
    expect(mail.text).toBe("alert body");
  });

  it("DRY_RUN logs instead of sending", async () => {
    const sent: SentMessage[] = [];
    const channel = EmailChannel.forTest({ transporter: fakeTransport(sent), dryRun: true });
    await channel.sendFailureAlert("alert subject", "alert body", logger);
    expect(sent).toHaveLength(0);
  });

  it("throws when unconfigured", async () => {
    const channel = EmailChannel.forTest({ transporter: undefined });
    await expect(
      channel.sendFailureAlert("alert subject", "alert body", logger),
    ).rejects.toThrow(/not configured/);
  });
});
