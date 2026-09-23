import { loadEnv } from "../../../../../src/config/env";

/**
 * Notification settings — read-only status view for V1. Editing happens in
 * .env (secrets never enter the browser); this page surfaces what's live.
 */

export default function SettingsPage() {
  let status: {
    dryRun: boolean;
    emailConfigured: boolean;
    notifyTo: string;
    smtpHost: string;
    aiConfigured: boolean;
    aiModel: string;
    allowLiveApi: boolean;
    syncIntervalMinutes: number;
  };
  try {
    const env = loadEnv();
    status = {
      dryRun: env.DRY_RUN,
      emailConfigured: Boolean(env.SMTP_HOST && env.NOTIFY_EMAIL_TO),
      notifyTo: env.NOTIFY_EMAIL_TO || "—",
      smtpHost: env.SMTP_HOST || "—",
      aiConfigured: env.AI_API_KEY.length > 0,
      aiModel: env.AI_MODEL,
      allowLiveApi: env.ALLOW_LIVE_API,
      syncIntervalMinutes: env.SYNC_INTERVAL_MINUTES,
    };
  } catch {
    status = {
      dryRun: true,
      emailConfigured: false,
      notifyTo: "—",
      smtpHost: "—",
      aiConfigured: false,
      aiModel: "—",
      allowLiveApi: false,
      syncIntervalMinutes: 30,
    };
  }

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex gap-3 border-b border-gray-900 py-2">
      <span className="text-gray-400 w-56 shrink-0">{k}</span>
      <span>{v}</span>
    </div>
  );

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-4">Settings</h1>
      <div className="text-sm">
        {row("Email notifications", status.emailConfigured ? "configured" : "not configured")}
        {row("Notify to", status.notifyTo)}
        {row("SMTP host", status.smtpHost)}
        {row(
          "DRY_RUN",
          status.dryRun ? (
            <span className="text-amber-400">
              true — emails are previewed in logs, not sent
            </span>
          ) : (
            <span className="text-emerald-400">false — emails will be sent</span>
          ),
        )}
        {row("AI extraction", status.aiConfigured ? `enabled (${status.aiModel})` : "disabled")}
        {row("Live API", status.allowLiveApi ? "allowed (opt-in)" : "blocked")}
        {row("Sync interval", `every ${status.syncIntervalMinutes} minutes`)}
      </div>
      <p className="text-gray-400 text-sm mt-6">
        Change these in the project&apos;s <code>.env</code> file, then restart the monitor
        or dashboard.
      </p>
    </div>
  );
}
