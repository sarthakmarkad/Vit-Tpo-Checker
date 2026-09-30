import { loadEnv } from "../config/env.js";
import { logger } from "../logger.js";
import { TpoClient } from "../tpo/client.js";
import { SigningSessionProvider } from "../tpo/session.js";
import { TpoSessionMissingError } from "../tpo/errors.js";
import { prisma } from "../database/client.js";
import { PlacementSyncService } from "../sync/placement-sync-service.js";
import { AttachmentService } from "../documents/attachment-service.js";
import { AiClient } from "../ai/client.js";
import { PlacementAIService } from "../ai/placement-ai-service.js";
import { EmailChannel } from "../notifications/email-channel.js";
import { NotificationService } from "../notifications/notification-service.js";
import { SyncFailureAlerter } from "../notifications/sync-failure-alerter.js";
import { PlacementMonitorJob } from "../scheduler/placement-monitor-job.js";
import type { SyncSummary } from "../sync/placement-sync-service.js";

/**
 * Long-running monitor (M7): fetch → normalize → detect → repeat.
 * Runs one sync immediately at startup (fail fast on misconfiguration),
 * then on the SYNC_INTERVAL_MINUTES schedule until interrupted.
 */

const log = logger.child({ script: "monitor" });

async function main(): Promise<void> {
  const env = loadEnv();
  const client = new TpoClient(await SigningSessionProvider.create());
  const ai = new PlacementAIService(new AiClient({}, log), log);
  const attachments = new AttachmentService(prisma, log, undefined, undefined, ai);
  const sync = new PlacementSyncService(client, prisma, log, attachments);
  const emailChannel = EmailChannel.fromEnv();
  const notifier = new NotificationService(prisma, log, [emailChannel].filter((c) => c !== undefined));
  const alerter = emailChannel
    ? new SyncFailureAlerter(
        async (subject, body) => emailChannel.sendFailureAlert(subject, body, log),
        log,
      )
    : undefined;

  // Sync + notify (M10) as one engine: notification failure never breaks the tick.
  // Repeated sync failures email a throttled operational alert (see SyncFailureAlerter).
  const syncEngine = {
    run: async (): Promise<SyncSummary> => {
      const startedAt = new Date();
      let summary: SyncSummary;
      try {
        summary = await sync.run();
      } catch (err) {
        await alerter?.recordFailure(err);
        throw err;
      }
      alerter?.recordSuccess();
      try {
        await notifier.notifySince(startedAt);
      } catch (err) {
        log.warn({ err: String(err) }, "notification failed (continuing)");
      }
      return summary;
    },
  };
  const monitor = new PlacementMonitorJob(syncEngine, log);

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "shutting down");
    await monitor.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  log.info({ allowLiveApi: env.ALLOW_LIVE_API }, "monitor starting");
  monitor.start();

  // First run happens right away so a misconfigured session/db surfaces now.
  await monitor.tick();
}

main().catch(async (err: unknown) => {
  if (err instanceof Error && err.name === "LiveApiDisabledError") {
    log.error(err.message);
  } else if (err instanceof TpoSessionMissingError) {
    log.error(err.message);
  } else {
    log.error({ err: String(err) }, "monitor failed to start");
  }
  await prisma.$disconnect();
  process.exit(1);
});
