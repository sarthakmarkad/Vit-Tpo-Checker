import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import type { Logger } from "../logger.js";
import { loadEnv } from "../config/env.js";
import type { SyncSummary } from "../sync/placement-sync-service.js";

/**
 * Scheduled monitoring (M7): runs the deterministic sync on a fixed interval.
 *
 * Safety properties:
 * - Idempotent by construction (the sync engine upserts by externalId).
 * - Overlap guard: a cron tick arriving while a run is still in flight is
 *   skipped, never queued — two concurrent runs would only duplicate work.
 * - A failed run never kills the process; the next tick retries naturally.
 *
 * Intervals map to cron expressions only when they are exact: minutes that
 * divide 60 evenly (e.g. 30 minutes → fires every 30 minutes) or whole-hour
 * multiples (e.g. 120 → every 2 hours). Anything else fails fast at startup
 * rather than silently producing an uneven cadence.
 */

export function intervalToCron(minutes: number): string | null {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) return null;
  if (minutes <= 59 && 60 % minutes === 0) return `*/${minutes} * * * *`;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `0 */${hours} * * *`;
  }
  return null;
}

interface SyncEngine {
  run(): Promise<SyncSummary>;
}

export class PlacementMonitorJob {
  private running = false;
  private task: ScheduledTask | undefined;

  constructor(
    private readonly sync: SyncEngine,
    private readonly log: Logger,
  ) {}

  /** One monitor tick. Never throws — failures are logged and the process survives. */
  async tick(): Promise<void> {
    if (this.running) {
      this.log.warn("previous sync still in flight; skipping tick");
      return;
    }
    this.running = true;
    try {
      await this.sync.run();
    } catch (err) {
      this.log.error({ err: String(err) }, "sync run failed; will retry on next tick");
    } finally {
      this.running = false;
    }
  }

  /** Schedule the sync. Returns the cron expression in use. */
  start(): string {
    const minutes = loadEnv().SYNC_INTERVAL_MINUTES;
    const expression = intervalToCron(minutes);
    if (!expression) {
      throw new Error(
        `SYNC_INTERVAL_MINUTES=${minutes} cannot be expressed as an exact cron ` +
          `schedule. Use a divisor of 60 (1, 2, 3, 5, 6, 10, 12, 15, 20, 30) ` +
          `or a whole number of hours.`,
      );
    }
    if (this.task) {
      throw new Error("monitor already started");
    }
    this.task = cron.schedule(expression, () => {
      void this.tick();
    });
    this.log.info({ expression, intervalMinutes: minutes }, "monitor scheduled");
    return expression;
  }

  /** Stop accepting new ticks and wait for the in-flight run to finish. */
  async stop(): Promise<void> {
    this.task?.stop();
    this.task?.destroy();
    this.task = undefined;
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.log.info("monitor stopped");
  }
}
