import { loadEnv } from "../config/env.js";
import { logger } from "../logger.js";
import { login } from "../tpo/login.js";
import { TpoError } from "../tpo/errors.js";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

/**
 * Interactive first-party login: generates a device key, solves ALTCHA,
 * and exchanges credentials for a session (stored in gitignored var/).
 * Credentials come from .env (TPO_USERNAME/TPO_PASSWORD) or a prompt.
 */

const env = loadEnv();
const log = logger.child({ script: "tpo-login" });

async function resolveCredentials(): Promise<{ uid: string; pass: string }> {
  if (env.TPO_USERNAME && env.TPO_PASSWORD) {
    return { uid: env.TPO_USERNAME, pass: env.TPO_PASSWORD };
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const uid = await rl.question("T&P username (e.g. 12400000@vit.edu): ");
  const pass = await rl.question("T&P password: ");
  rl.close();
  return { uid: uid.trim(), pass };
}

async function main(): Promise<number> {
  const { uid, pass } = await resolveCredentials();
  if (!uid || !pass) {
    log.error("username and password are required");
    return 2;
  }
  log.info({ uid }, "logging in (device key will be registered for this client)");
  const session = await login(uid, pass);
  log.info(
    { uid: session.uid, tenant: session.tenant, usertype: session.usertype },
    "✓ session established — run `npm run probe` to verify the pipeline",
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    if (err instanceof TpoError) {
      log.error({ err: err.message }, "login failed");
      process.exit(1);
    }
    log.error({ err }, "unexpected login failure");
    process.exit(1);
  });
