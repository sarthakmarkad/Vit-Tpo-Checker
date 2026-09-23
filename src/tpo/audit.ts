import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Audit log of every live API request, for full transparency: the user can
 * always see exactly what was sent to the college server and when.
 * Lives in gitignored var/. Never contains secrets — only metadata.
 */

const AUDIT_FILE = join("var", "api-audit.log");

export async function auditLiveRequest(entry: {
  method: string;
  path: string;
  status?: number;
  ok: boolean;
  note?: string | undefined;
}): Promise<void> {
  try {
    await mkdir("var", { recursive: true });
    const line =
      JSON.stringify({
        at: new Date().toISOString(),
        method: entry.method,
        path: entry.path,
        status: entry.status ?? null,
        ok: entry.ok,
        note: entry.note ?? null,
      }) + "\n";
    await appendFile(AUDIT_FILE, line, { mode: 0o644 });
  } catch {
    // Auditing must never break the request path.
  }
}

export async function countTodayAuditEntries(): Promise<number> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(AUDIT_FILE, "utf8");
    const today = new Date().toISOString().slice(0, 10);
    return raw
      .split("\n")
      .filter((l) => l.includes(`"at":"${today}`))
      .length;
  } catch {
    return 0;
  }
}
