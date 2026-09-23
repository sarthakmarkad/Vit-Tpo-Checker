import Link from "next/link";
import { db } from "@/lib/db";
import { fmtDate, lpa, statusIcon, eligibilityFor } from "@/lib/display";

export default async function OpportunitiesPage() {
  const [profile, opportunities] = await Promise.all([
    db.studentProfile.findFirst(),
    db.placementOpportunity.findMany({
      orderBy: [{ isActive: "desc" }, { registrationEnd: "asc" }, { companyName: "asc" }],
    }),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Companies &amp; placements</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-gray-400 border-b border-gray-800">
          <tr>
            <th className="py-2">Fit</th>
            <th>Company</th>
            <th>Type</th>
            <th>Package</th>
            <th>Deadline</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((o) => {
            const result = eligibilityFor(o, profile);
            return (
              <tr key={o.id} className="border-b border-gray-900">
                <td className="py-2">{statusIcon(result.status)}</td>
                <td>
                  <Link href={`/opportunities/${o.externalId}`}>{o.companyName}</Link>
                </td>
                <td className="text-gray-400">{o.placementType ?? "—"}</td>
                <td>{lpa(o.packageLpa)}</td>
                <td className="text-gray-400">{fmtDate(o.registrationEnd)}</td>
                <td>
                  {o.isActive ? (
                    <span className="text-emerald-400">active</span>
                  ) : (
                    <span className="text-gray-600">inactive</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {opportunities.length === 0 && (
        <p className="text-gray-400 mt-4">
          Nothing stored yet — run <code>npm run sync:once</code>.
        </p>
      )}
    </div>
  );
}
