import { prisma } from "../database/client.js";
import { logger } from "../logger.js";

/**
 * Student profile CLI (M11, single-user V1):
 *   npm run profile show
 *   npm run profile -- set cgpa=8.2 branch=CSE graduationYear=2028 activeBacklogs=0 skills=java,python
 *
 * Values are stored under the default user; numeric fields parse as numbers,
 * list fields as comma-separated values.
 */

const DEFAULT_EMAIL = "me@local";

const NUMERIC_KEYS = [
  "graduationYear",
  "cgpa",
  "sscPercentage",
  "hscPercentage",
  "diplomaPercentage",
  "activeBacklogs",
  "deadBacklogs",
] as const;

const LIST_KEYS = ["skills", "preferredRoles", "preferredLocations"] as const;

const STRING_KEYS = ["displayName", "branch", "program"] as const;

async function getOrCreateProfile() {
  const user = await prisma.user.upsert({
    where: { email: DEFAULT_EMAIL },
    create: { email: DEFAULT_EMAIL },
    update: {},
  });
  return prisma.studentProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
    include: { user: true },
  });
}

function parseValue(key: string, raw: string): unknown {
  if ((NUMERIC_KEYS as readonly string[]).includes(key)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${key}: '${raw}' is not a number`);
    return Math.trunc(n) === n ? n : n;
  }
  if ((LIST_KEYS as readonly string[]).includes(key)) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if ((STRING_KEYS as readonly string[]).includes(key)) {
    return raw;
  }
  throw new Error(
    `unknown field '${key}' (allowed: ${[...NUMERIC_KEYS, ...LIST_KEYS, ...STRING_KEYS].join(", ")})`,
  );
}

function render(profile: Awaited<ReturnType<typeof getOrCreateProfile>>): void {
  const lines = [
    `displayName:        ${profile.user.displayName ?? "—"}`,
    `branch:             ${profile.branch ?? "—"}`,
    `program:            ${profile.program ?? "—"}`,
    `graduationYear:     ${profile.graduationYear ?? "—"}`,
    `cgpa:               ${profile.cgpa ?? "—"}`,
    `sscPercentage:      ${profile.sscPercentage ?? "—"}`,
    `hscPercentage:      ${profile.hscPercentage ?? "—"}`,
    `diplomaPercentage:  ${profile.diplomaPercentage ?? "—"}`,
    `activeBacklogs:     ${profile.activeBacklogs}`,
    `deadBacklogs:       ${profile.deadBacklogs}`,
    `skills:             ${(profile.skills as string[] | null)?.join(", ") ?? "—"}`,
    `preferredRoles:     ${(profile.preferredRoles as string[] | null)?.join(", ") ?? "—"}`,
    `preferredLocations: ${(profile.preferredLocations as string[] | null)?.join(", ") ?? "—"}`,
  ];
  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const profile = await getOrCreateProfile();

  if (command === "show" || command === undefined) {
    render(profile);
    return;
  }
  if (command === "set") {
    if (rest.length === 0) throw new Error("no fields given; usage: set key=value ...");
    const data: Record<string, unknown> = {};
    const userUpdate: Record<string, unknown> = {};
    for (const pair of rest) {
      const eq = pair.indexOf("=");
      if (eq <= 0) throw new Error(`'${pair}' is not key=value`);
      const key = pair.slice(0, eq);
      const value = parseValue(key, pair.slice(eq + 1));
      if (key === "displayName") {
        userUpdate.displayName = value;
        continue;
      }
      data[key] = value;
    }
    await prisma.studentProfile.update({ where: { id: profile.id }, data });
    if (Object.keys(userUpdate).length > 0) {
      await prisma.user.update({ where: { id: profile.userId }, data: userUpdate });
    }
    const updated = await prisma.studentProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: { user: true },
    });
    console.log("updated.\n");
    render(updated);
    return;
  }
  throw new Error(`unknown command '${command}' (use show | set)`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    logger.error({ err: String(err) }, "profile command failed");
    await prisma.$disconnect();
    process.exit(1);
  });
