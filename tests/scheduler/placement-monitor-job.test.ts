import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/logger.js";
import { loadEnv } from "../../src/config/env.js";
import {
  PlacementMonitorJob,
  intervalToCron,
} from "../../src/scheduler/placement-monitor-job.js";
import type { SyncSummary } from "../../src/sync/placement-sync-service.js";

vi.mock("../../src/config/env.js", () => {
  const env = { LOG_LEVEL: "silent", SYNC_INTERVAL_MINUTES: 30 };
  return { loadEnv: vi.fn(() => env) };
});

function summary(overrides: Partial<SyncSummary> = {}): SyncSummary {
  return {
    fetched: 1,
    created: 0,
    updated: 0,
    unchanged: 1,
    failed: 0,
    durationMs: 10,
    syncRunId: 1,
    ...overrides,
  };
}

function makeSync(results: Array<Promise<SyncSummary>> | Error, calls?: number[]) {
  let i = 0;
  const list = Array.isArray(results) ? results : [];
  const err = results instanceof Error ? results : undefined;
  return {
    run: async () => {
      calls?.push(i);
      i += 1;
      if (err) throw err;
      return list[Math.min(i - 1, list.length - 1)];
    },
  };
}

describe("intervalToCron", () => {
  it("maps exact minute divisors", () => {
    expect(intervalToCron(30)).toBe("*/30 * * * *");
    expect(intervalToCron(15)).toBe("*/15 * * * *");
    expect(intervalToCron(1)).toBe("*/1 * * * *");
  });

  it("maps whole-hour multiples", () => {
    expect(intervalToCron(60)).toBe("0 */1 * * *");
    expect(intervalToCron(720)).toBe("0 */12 * * *");
  });

  it("rejects inexact intervals and out-of-range values", () => {
    expect(intervalToCron(45)).toBeNull();
    expect(intervalToCron(7)).toBeNull();
    expect(intervalToCron(0)).toBeNull();
    expect(intervalToCron(-30)).toBeNull();
    expect(intervalToCron(1440)).toBeNull();
  });
});

describe("PlacementMonitorJob", () => {
  let calls: number[];

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tick runs the sync and is sequential", async () => {
    const job = new PlacementMonitorJob(makeSync([summary(), summary()], calls), logger);
    await job.tick();
    await job.tick();
    expect(calls).toEqual([0, 1]);
  });

  it("overlapping ticks are skipped, never queued", async () => {
    let releaseRun: (() => void) | undefined;
    let entered = 0;
    const slowSync = {
      run: () =>
        new Promise<SyncSummary>((resolve) => {
          entered += 1;
          releaseRun = () => resolve(summary());
        }),
    };
    const job = new PlacementMonitorJob(slowSync, logger);
    const first = job.tick();
    await job.tick(); // in flight → skipped
    releaseRun!();
    await first;
    expect(entered).toBe(1);
  });

  it("a failed run is swallowed and the next tick runs again", async () => {
    const job = new PlacementMonitorJob(
      makeSync(new Error("boom"), calls),
      logger,
    );
    await expect(job.tick()).resolves.toBeUndefined();
    await expect(job.tick()).resolves.toBeUndefined();
    expect(calls).toEqual([0, 1]);
  });

  it("start validates the interval and stop is idempotent", async () => {
    const job = new PlacementMonitorJob(makeSync([], calls), logger);
    vi.mocked(loadEnv).mockReturnValue({
      LOG_LEVEL: "silent",
      SYNC_INTERVAL_MINUTES: 45,
    } as never);
    expect(() => job.start()).toThrow(/exact cron/);

    vi.mocked(loadEnv).mockReturnValue({
      LOG_LEVEL: "silent",
      SYNC_INTERVAL_MINUTES: 30,
    } as never);
    const expression = job.start();
    expect(expression).toBe("*/30 * * * *");
    expect(() => job.start()).toThrow(/already started/);

    await job.stop();
    await job.stop(); // idempotent
  });

  it("stop waits for an in-flight run to finish", async () => {
    let releaseRun: (() => void) | undefined;
    const slowSync = {
      run: () =>
        new Promise<SyncSummary>((resolve) => {
          releaseRun = () => resolve(summary());
        }),
    };
    const job = new PlacementMonitorJob(slowSync, logger);
    const inFlight = job.tick();
    const stopped = job.stop();
    releaseRun!();
    await stopped;
    await inFlight;
  });
});
