"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

/** `label` is translated on the server, so no message catalog ships to the browser. */
export function ThemeToggle({ label }: { label: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex size-9 items-center justify-center rounded-md border border-border hover:bg-muted"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/* Both icons render; CSS shows the right one, so there is no hydration flash. */}
      <Sun aria-hidden className="hidden size-4 dark:block" />
      <Moon aria-hidden className="size-4 dark:hidden" />
    </button>
  );
}
