import Link from "next/link";
import { db } from "@/lib/db";
import { fmtDate, daysLeft } from "@/lib/display";

export default async function DeadlinesPage() {
  const opportunities = await db.placementOpportunity.findMany({
    where: { isActive: true },
    orderBy: { registrationEnd: "asc" },
  });

  const open = opportunities.filter((o) => o.registrationEnd && daysLeft(o.registrationEnd)! >= 0);
  const closed = opportunities.filter(
    (o) => !o.registrationEnd || daysLeft(o.registrationEnd)! < 0,
  );

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Deadlines</h1>
      <h2 className="text-sm text-gray-400 mb-2">Open</h2>
      <ul className="space-y-2">
        {open.map((o) => {
          const days = daysLeft(o.registrationEnd)!;
          const urgency =
            days <= 2 ? "text-red-400" : days <= 7 ? "text-amber-400" : "text-gray-400";
          return (
            <li key={o.id} className="flex items-baseline gap-3">
              <Link href={`/opportunities/${o.externalId}`}>{o.companyName}</Link>
              <span className="text-gray-500">{fmtDate(o.registrationEnd)}</span>
              <span className={`ml-auto text-sm ${urgency}`}>
                {days === 0 ? "today" : `${days} day(s) left`}
              </span>
            </li>
          );
        })}
        {open.length === 0 && <li className="text-gray-400">None open.</li>}
      </ul>

      {closed.length > 0 && (
        <>
          <h2 className="text-sm text-gray-400 mt-6 mb-2">Closed / no date</h2>
          <ul className="space-y-1 text-gray-500">
            {closed.map((o) => (
              <li key={o.id}>
                <Link href={`/opportunities/${o.externalId}`}>{o.companyName}</Link>{" "}
                · {fmtDate(o.registrationEnd)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
