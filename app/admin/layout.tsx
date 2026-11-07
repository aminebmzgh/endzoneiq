import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "EndzoneIQ admin",
  robots: { index: false, follow: false },
};

/** Internal tool: English only, outside the localized site. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
