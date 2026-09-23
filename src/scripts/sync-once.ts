import { loadEnv } from "../config/env.js";
import { logger } from "../logger.js";
import { TpoClient } from "../tpo/client.js";
import { SigningSessionProvider } from "../tpo/session.js";
import { TpoError, TpoSessionMissingError } from "../tpo/errors.js";
import { prisma } from "../database/client.js";
import { PlacementSyncService } from "../sync/placement-sync-service.js";
import { AttachmentService } from "../documents/attachment-service.js";
import { AiClient } from "../ai/client.js";
import { PlacementAIService } from "../ai/placement-ai-service.js";
import { EmailChannel } from "../notifications/email-channel.js";
import { NotificationService } from "../notifications/notification-service.js";

/**
 * One-shot synchronization run (the first vertical slice):
 *   TPO API → fetch → normalize → PostgreSQL → detect new/changed → log
 */

const log = logger.child({ script: "sync-once" });

async function main(): Promise<number> {
  const client = new TpoClient(await SigningSessionProvider.create());
  const ai = new PlacementAIService(new AiClient({}, log), log);
  const attachments = new AttachmentService(prisma, log, undefined, undefined, ai);
  const service = new PlacementSyncService(client, prisma, log, attachments);
  const notifier = new NotificationService(prisma, log, [EmailChannel.fromEnv()].filter((c) => c !== undefined));

  const startedAt = new Date();
  log.info("SYNC START");
  const summary = await service.run();
  log.info(
    {
      fetched: summary.fetched,
      new: summary.created,
      updated: summary.updated,
      unchanged: summary.unchanged,
      failed: summary.failed,
      durationMs: summary.durationMs,
    },
    "SYNC COMPLETE",
  );

  // M10: best-effort digest; failure never fails the sync.
  try {
    await notifier.notifySince(startedAt);
  } catch (err) {
    log.warn({ err: String(err) }, "notification failed (continuing)");
  }
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    if (err instanceof Error && err.name === "LiveApiDisabledError") {
      log.error(err.message);
      await prisma.$disconnect();
      process.exit(3);
    }
    if (err instanceof TpoSessionMissingError) {
      log.error(err.message);
      await prisma.$disconnect();
      process.exit(2);
    }
    if (err instanceof TpoError) {
      log.error({ err: err.message }, "sync failed");
      await prisma.$disconnect();
      process.exit(1);
    }
    log.error({ err }, "unexpected sync failure");
    await prisma.$disconnect();
    process.exit(1);
  });
