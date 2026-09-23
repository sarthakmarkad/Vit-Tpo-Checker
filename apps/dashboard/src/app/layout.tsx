import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Placement Intelligence",
  description: "Personal placement monitoring dashboard",
};

/** All pages read the live database — never prerender stale data. */
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/opportunities", label: "Companies" },
  { href: "/eligible", label: "Eligible For You" },
  { href: "/deadlines", label: "Deadlines" },
  { href: "/changes", label: "Changes" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-gray-800 px-6 py-3 flex items-center gap-6">
          <Link href="/" className="font-semibold text-sky-400">
            🎓 Placement Intelligence
          </Link>
          <nav className="flex gap-4 text-sm">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:underline">
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
