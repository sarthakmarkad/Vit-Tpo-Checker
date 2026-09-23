"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";

export async function saveProfile(formData: FormData): Promise<void> {
  const user = await db.user.upsert({
    where: { email: "me@local" },
    create: { email: "me@local" },
    update: {},
  });

  const num = (key: string): number | null => {
    const raw = formData.get(key);
    if (typeof raw !== "string" || raw.trim() === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const str = (key: string): string | null => {
    const raw = formData.get(key);
    return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
  };
  const list = (key: string): string[] => {
    const raw = formData.get(key);
    return typeof raw === "string"
      ? raw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  };

  const displayName = str("displayName");

  await db.studentProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      branch: str("branch"),
      program: str("program"),
      graduationYear: num("graduationYear"),
      cgpa: num("cgpa"),
      sscPercentage: num("sscPercentage"),
      hscPercentage: num("hscPercentage"),
      diplomaPercentage: num("diplomaPercentage"),
      activeBacklogs: num("activeBacklogs") ?? 0,
      deadBacklogs: num("deadBacklogs") ?? 0,
      skills: list("skills"),
      preferredRoles: list("preferredRoles"),
      preferredLocations: list("preferredLocations"),
    },
    update: {
      branch: str("branch"),
      program: str("program"),
      graduationYear: num("graduationYear"),
      cgpa: num("cgpa"),
      sscPercentage: num("sscPercentage"),
      hscPercentage: num("hscPercentage"),
      diplomaPercentage: num("diplomaPercentage"),
      activeBacklogs: num("activeBacklogs") ?? 0,
      deadBacklogs: num("deadBacklogs") ?? 0,
      skills: list("skills"),
      preferredRoles: list("preferredRoles"),
      preferredLocations: list("preferredLocations"),
    },
  });

  if (displayName !== null) {
    await db.user.update({ where: { id: user.id }, data: { displayName } });
  }

  revalidatePath("/profile");
  revalidatePath("/eligible");
  revalidatePath("/");
}
