import { saveProfile } from "./actions";
import { db } from "@/lib/db";

const inputClass =
  "w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm focus:border-sky-500 focus:outline-none";

function Field({
  label,
  name,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-gray-400">{label}</span>
      <input name={name} defaultValue={defaultValue} placeholder={placeholder} className={inputClass} />
    </label>
  );
}

export default async function ProfilePage() {
  const profile = await db.studentProfile.findFirst({ include: { user: true } });

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold mb-4">Your profile</h1>
      <form action={saveProfile} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Display name" name="displayName" defaultValue={profile?.user.displayName ?? ""} />
          <Field label="Branch" name="branch" defaultValue={profile?.branch ?? ""} placeholder="Computer Science" />
          <Field label="Program" name="program" defaultValue={profile?.program ?? ""} placeholder="BTech" />
          <Field label="Graduation year" name="graduationYear" defaultValue={profile?.graduationYear?.toString() ?? ""} placeholder="2028" />
          <Field label="CGPA" name="cgpa" defaultValue={profile?.cgpa?.toString() ?? ""} placeholder="8.2" />
          <Field label="SSC %" name="sscPercentage" defaultValue={profile?.sscPercentage?.toString() ?? ""} />
          <Field label="HSC %" name="hscPercentage" defaultValue={profile?.hscPercentage?.toString() ?? ""} />
          <Field label="Diploma %" name="diplomaPercentage" defaultValue={profile?.diplomaPercentage?.toString() ?? ""} />
          <Field label="Active backlogs" name="activeBacklogs" defaultValue={profile?.activeBacklogs?.toString() ?? "0"} />
          <Field label="Dead backlogs" name="deadBacklogs" defaultValue={profile?.deadBacklogs?.toString() ?? "0"} />
          <Field label="Skills (comma-separated)" name="skills" defaultValue={(profile?.skills as string[] | null)?.join(", ") ?? ""} placeholder="java, python" />
          <Field label="Preferred roles" name="preferredRoles" defaultValue={(profile?.preferredRoles as string[] | null)?.join(", ") ?? ""} />
          <Field label="Preferred locations" name="preferredLocations" defaultValue={(profile?.preferredLocations as string[] | null)?.join(", ") ?? ""} />
        </div>
        <button
          type="submit"
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
        >
          Save profile
        </button>
      </form>
    </div>
  );
}
