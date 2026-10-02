import type { Logger } from "../logger.js";

/** Delivery function for alerts — injected so throttling is unit-testable. */
export type AlertSender = (subject: string, body: string) => Promise<void>;

/**
 * Throttled sync-failure alerting: a single failed tick is routine (portal
 * blip, restart in flight), but repeated consecutive failures mean the
 * monitor is effectively down (expired session, DB unreachable). Alerts on
 * every Nth consecutive failure (default 3 → first alert ~90 min into an
 * outage at the 30-minute cadence), and resets silently on the next
 * successful run. Alert-delivery failures never propagate.
 */
export class SyncFailureAlerter {
  private consecutiveFailures = 0;

  constructor(
    private readonly send: AlertSender,
    private readonly log: Logger,
    private readonly alertEvery = 3,
  ) {}

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  async recordFailure(err: unknown): Promise<void> {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures % this.alertEvery !== 0) return;

    const errText = String(err);
    const hint = errText.includes("401")
      ? "The T&P session expired and the automatic re-login did not fix it —\n" +
        "most likely the stored password changed. Update TPO_USERNAME/TPO_PASSWORD\n" +
        "in .env if needed, run `npm run login` once, then\n" +
        "`launchctl kickstart -k gui/$(id -u)/com.sarthakmarkad.placement-monitor`."
      : "Check `var/logs/launchd.out.log` (or `var/logs/launchd.err.log`) for details.";
    const subject = `Placement monitor: ${this.consecutiveFailures} consecutive sync failures`;
    const body =
      `The placement monitor has failed ${this.consecutiveFailures} consecutive ` +
      `sync runs (30-minute cadence — the monitor is effectively down).\n\n` +
      `Last error: ${errText}\n\n${hint}\n\n` +
      `This alert repeats every ${this.alertEvery} further failures and stops ` +
      `on the next successful sync.`;

    try {
      await this.send(subject, body);
      this.log.warn({ failures: this.consecutiveFailures }, "sync failure alert sent");
    } catch (alertErr) {
      this.log.error(
        { err: String(alertErr) },
        "failure alert could not be sent (continuing)",
      );
    }
  }
}
