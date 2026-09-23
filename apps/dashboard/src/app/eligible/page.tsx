import Link from "next/link";
import { db } from "@/lib/db";
import { eligibilityFor, fmtDate, lpa, statusIcon } from "@/lib/display";

export default async function EligiblePage() {
  const [profile, opportunities] = await Promise.all([
    db.studentProfile.findFirst(),
    db.placementOpportunity.findMany({
      where: { isActive: true },
      orderBy: [{ registrationEnd: "asc" }, { companyName: "asc" }],
    }),
  ]);

  const evaluated = opportunities
    .map((o) => ({ o, result: eligibilityFor(o, profile) }))
    .sort((a, b) => {
      const order = { uncertain: 0, eligible: 1, not_eligible: 2 };
      return order[a.result.status] - order[b.result.status];
    });

  return (
    <div>
      <h1 className="text-xl font-semibold mb-2">Eligible for you</h1>
      <p className="text-gray-400 text-sm mb-4">
        Deterministic evaluation of every active placement against your profile. 🟡
        means nothing failed but some criterion could not be verified — review those.
      </p>
      <div className="space-y-3">
        {evaluated.map(({ o, result }) => (
          <div
            key={o.id}
            className="rounded-lg border border-gray-800 bg-gray-900 p-4"
          >
            <div className="flex items-baseline gap-3">
              <span>{statusIcon(result.status)}</span>
              <Link href={`/opportunities/${o.externalId}`} className="font-medium">
                {o.companyName}
              </Link>
              <span className="text-gray-400 text-sm">{lpa(o.packageLpa)}</span>
              <span className="text-gray-500 text-sm ml-auto">
                deadline {fmtDate(o.registrationEnd)}
              </span>
            </div>
            {result.reasons.length > 0 && (
              <ul className="mt-2 text-sm text-amber-400 list-disc list-inside">
                {result.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {evaluated.length === 0 && (
          <p className="text-gray-400">No active placements yet.</p>
        )}
      </div>
    </div>
  );
}
