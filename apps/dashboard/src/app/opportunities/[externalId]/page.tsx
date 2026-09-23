import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { eligibilityFor, fmtDate, lpa, statusIcon } from "@/lib/display";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <h2 className="text-sm font-semibold text-gray-300 mb-2">{title}</h2>
      {children}
    </section>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-400 w-44 shrink-0">{k}</span>
      <span>{v}</span>
    </div>
  );
}

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ externalId: string }>;
}) {
  const { externalId } = await params;
  const [opp, profile] = await Promise.all([
    db.placementOpportunity.findUnique({
      where: { externalId },
      include: { requirements: true, attachments: true, changes: { orderBy: { detectedAt: "desc" } } },
    }),
    db.studentProfile.findFirst(),
  ]);
  if (!opp) notFound();

  const result = eligibilityFor(opp, profile);
  const stringList = (v: unknown) =>
    Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [];
  const stipendText = (o: typeof opp) => {
    const range = [o.minStipend, o.maxStipend].filter((n) => n !== null).join("–");
    return range.length > 0 ? range : "—";
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">
          {statusIcon(result.status)} {opp.companyName}{" "}
          <span className="text-gray-500 text-sm">#{opp.externalId}</span>
        </h1>
        <p className="text-gray-400 text-sm">
          {opp.placementType ?? "—"} · {lpa(opp.packageLpa)} · deadline {fmtDate(opp.registrationEnd)}
        </p>
      </div>

      <Section title="Eligibility vs your profile">
        <div className="grid gap-1 text-sm font-mono">
          {result.checks.map((c) => (
            <div key={c.criterion} className="flex gap-3">
              <span className="w-40 text-gray-400">{c.criterion}</span>
              <span className="w-40">req: {c.required}</span>
              <span className="w-40">you: {c.actual}</span>
              <span
                className={
                  c.status === "satisfied"
                    ? "text-emerald-400"
                    : c.status === "failed"
                      ? "text-red-400"
                      : "text-amber-400"
                }
              >
                {c.status}
              </span>
            </div>
          ))}
        </div>
        {result.reasons.length > 0 && (
          <ul className="mt-2 text-sm text-amber-400 list-disc list-inside">
            {result.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Details">
          <div className="space-y-1 text-sm">
            <KV k="Offering code" v={opp.offeringCode ?? "—"} />
            <KV k="Academic year" v={opp.academicYear ?? "—"} />
            <KV k="Company type" v={opp.companyType ?? "—"} />
            <KV k="Internship type" v={opp.internshipType ?? "—"} />
            <KV k="Stipend" v={opp.stipendDescription ?? stipendText(opp)} />
            <KV k="Registration" v={`${fmtDate(opp.registrationStart)} → ${fmtDate(opp.registrationEnd)}`} />
            <KV k="Programs" v={stringList(opp.programs).join(", ") || "—"} />
            <KV k="Grad years" v={stringList(opp.graduationYears).join(", ") || "—"} />
            <KV k="Locations" v={stringList(opp.locations).join(", ") || "—"} />
            <KV k="Skills" v={stringList(opp.skills).join(", ") || "—"} />
            <KV k="Selection" v={stringList(opp.selectionProcess).join(" → ") || "—"} />
            <KV k="Placed students" v={opp.placedStudentsAllowed === null ? "—" : String(opp.placedStudentsAllowed)} />
            <KV k="Year down" v={opp.yearDownAllowed === null ? "—" : String(opp.yearDownAllowed)} />
          </div>
        </Section>

        <Section title="Description">
          <p className="text-sm whitespace-pre-wrap">{opp.description ?? "—"}</p>
          {opp.jobDescription && (
            <p className="text-sm text-gray-400 mt-2 whitespace-pre-wrap">{opp.jobDescription}</p>
          )}
        </Section>
      </div>

      <Section title="Attachments">
        {opp.attachments.length === 0 ? (
          <p className="text-gray-400 text-sm">None.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {opp.attachments.map((a) => (
              <li key={a.id}>
                📄 {a.filename}
                {a.downloadedAt ? (
                  <span className="text-gray-400"> · stored {fmtDate(a.downloadedAt)}</span>
                ) : (
                  <span className="text-amber-400"> · not downloaded</span>
                )}
                {a.aiModel && (
                  <span className="text-gray-400">
                    {" "}
                    · AI ({a.aiModel}) confidence:{" "}
                    {(a.aiExtraction as { confidence?: string } | null)?.confidence ?? "—"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Change history">
        {opp.changes.length === 0 ? (
          <p className="text-gray-400 text-sm">No changes recorded.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {opp.changes.map((c) => (
              <li key={c.id}>
                {c.type === "new" ? "🆕" : "♻️"} {c.type} ·{" "}
                {new Date(c.detectedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
