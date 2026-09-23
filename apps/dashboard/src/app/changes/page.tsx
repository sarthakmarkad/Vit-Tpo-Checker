import Link from "next/link";
import { db } from "@/lib/db";

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v instanceof Object) return JSON.stringify(v);
  return String(v);
}

export default async function ChangesPage() {
  const changes = await db.placementChange.findMany({
    include: { opportunity: true },
    orderBy: { detectedAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Changes (latest 100)</h1>
      <div className="space-y-3">
        {changes.map((c) => {
          const fields = Array.isArray(c.fieldChanges)
            ? (c.fieldChanges as Array<{ field: string; from: unknown; to: unknown }>)
            : [];
          return (
            <div key={c.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-sm">
              <div className="flex items-baseline gap-3">
                <span>{c.type === "new" ? "🆕" : "♻️"}</span>
                <Link href={`/opportunities/${c.externalId}`} className="font-medium">
                  {c.opportunity.companyName}
                </Link>
                <span className="text-gray-500 ml-auto">
                  {new Date(c.detectedAt).toLocaleString()}
                </span>
              </div>
              {fields.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-gray-300">
                  {fields.map((f, i) => (
                    <li key={i}>
                      <span className="text-gray-400">{f.field}</span>: {fmt(f.from)} →{" "}
                      {fmt(f.to)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {changes.length === 0 && <p className="text-gray-400">No changes recorded yet.</p>}
      </div>
    </div>
  );
}
