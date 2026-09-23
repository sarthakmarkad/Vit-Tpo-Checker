import Link from "next/link";
import { db } from "@/lib/db";
import { eligibilityFor, fmtDate, lpa, statusIcon } from "@/lib/display";

function Stat({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-gray-800 bg-gray-900 p-4 hover:border-gray-600"
    >
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-gray-400">{label}</div>
    </Link>
  );
}

export default async function OverviewPage() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [profile, opportunities, newCount, changeCount, upcoming] = await Promise.all([
    db.studentProfile.findFirst(),
    db.placementOpportunity.findMany({
      where: { isActive: true },
      orderBy: [{ registrationEnd: "asc" }, { companyName: "asc" }],
    }),
    db.placementChange.count({ where: { type: "new", detectedAt: { gte: weekAgo } } }),
    db.placementChange.count({ where: { type: "updated", detectedAt: { gte: weekAgo } } }),
    db.placementOpportunity.findMany({
      where: { isActive: true, registrationEnd: { gte: new Date() } },
      orderBy: { registrationEnd: "asc" },
      take: 5,
    }),
  ]);

  const evaluations = opportunities.map((o) => ({
    opp: o,
    result: eligibilityFor(o, profile),
  }));
  const eligible = evaluations.filter((e) => e.result.status === "eligible").length;
  const uncertain = evaluations.filter((e) => e.result.status === "uncertain").length;
  const lastSync = await db.syncRun.findFirst({ orderBy: { id: "desc" } });

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-xl font-semibold mb-3">Overview</h1>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Active placements" value={opportunities.length} href="/opportunities" />
          <Stat label="🟢 Eligible for you" value={eligible} href="/eligible" />
          <Stat label="🟡 Uncertain" value={uncertain} href="/eligible" />
          <Stat label="New (7d)" value={newCount} href="/changes" />
          <Stat label="Changes (7d)" value={changeCount} href="/changes" />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Next deadlines</h2>
        {upcoming.length === 0 ? (
          <p className="text-gray-400">No upcoming deadlines.</p>
        ) : (
          <ul className="space-y-1">
            {upcoming.map((o) => (
              <li key={o.id}>
                <Link href={`/opportunities/${o.externalId}`}>
                  {o.companyName}
                </Link>{" "}
                <span className="text-gray-400">
                  · {lpa(o.packageLpa)} · closes {fmtDate(o.registrationEnd)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="text-sm text-gray-400">
        {lastSync
          ? `Last sync run #${lastSync.id}: ${lastSync.status}, ${lastSync.fetched} fetched (${new Date(lastSync.startedAt).toLocaleString()})`
          : "No sync run recorded yet."}
      </section>
    </div>
  );
}
