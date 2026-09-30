import { z } from "zod";

/**
 * Environment-driven configuration. Loaded once, validated with Zod.
 * Secrets never appear in logs; only presence is validated here.
 */

const booleanEnv = (fallback: boolean) =>
  z.preprocess(
    (v) => {
      if (v === undefined || v === null || v === "") return fallback;
      const s = String(v).trim().toLowerCase();
      if (s === "true" || s === "1" || s === "yes") return true;
      if (s === "false" || s === "0" || s === "no") return false;
      return undefined;
    },
    z.boolean(),
  );

const optionalSecret = z
  .string()
  .transform((s) => s.trim())
  .default("");

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Global kill-switch for external side effects (email sending, ...). */
  DRY_RUN: booleanEnv(true),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  /** off = never persist raw transport payloads; debug = redacted capture to var/debug-captures */
  RAW_CAPTURE: z.enum(["off", "debug"]).default("off"),

  // ---- Live API safety guardrails ----
  /**
   * Live calls to the college API are OPT-IN. When false, any request to the
   * real API host is refused — offline/mock development only.
   * Never enabled by default; the user opts in deliberately.
   */
  ALLOW_LIVE_API: booleanEnv(false),
  /** Hard per-run budget of API requests (protects the college server). */
  MAX_API_CALLS_PER_RUN: z.coerce.number().int().min(1).max(500).default(60),
  /**
   * Rolling 24h cap on API requests, counted from the audit log. A 30-minute
   * monitor makes ~5 calls/tick (~240/day for a small listing), so the cap
   * must stay above that or the monitor starves mid-day.
   */
  TPO_DAILY_MAX_API_CALLS: z.coerce.number().int().min(1).max(10_000).default(240),
  /** Minimum spacing between consecutive API requests (ms). */
  API_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),

  // ---- TPO API ----
  TPO_API_BASE_URL: z.url().default("https://tpoapi.vierp.in"),
  /** First-party login credentials (used by `npm run login`) */
  TPO_USERNAME: optionalSecret,
  TPO_PASSWORD: optionalSecret,
  TPO_EPS_UID: optionalSecret,
  TPO_EPS_TENANT: optionalSecret,
  TPO_DEVICE_SIGNATURE: optionalSecret,
  TPO_REQUEST_TIMESTAMP: optionalSecret,

  // ---- Database ----
  DATABASE_URL: z
    .string()
    .default(
      "postgresql://postgres:postgres@localhost:5432/placement_intel?schema=public",
    ),

  // ---- Sync ----
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(720).default(30),

  // ---- Email (M10) ----
  SMTP_HOST: optionalSecret,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: optionalSecret,
  SMTP_PASS: optionalSecret,
  NOTIFY_EMAIL_TO: optionalSecret,

  // ---- AI (M9) ----
  AI_API_KEY: optionalSecret,
  /** OpenAI-compatible endpoint (any provider speaking the chat-completions API). */
  AI_API_BASE_URL: z
    .string()
    .default("https://api.openai.com/v1"),
  AI_MODEL: z.string().default("gpt-4o-mini"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  // Load .env if present (no external dep needed on Node >= 20.6)
  try {
    process.loadEnvFile?.();
  } catch {
    // .env absent — fine for tests/CI
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: build an Env from a partial object. */
export function makeEnv(overrides: Partial<Env> = {}): Env {
  return envSchema.parse({ NODE_ENV: "test", ...overrides });
}
