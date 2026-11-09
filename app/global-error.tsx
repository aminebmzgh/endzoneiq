"use client";

import { useEffect } from "react";
import { errorCopy } from "@/components/error-copy";
import { reportClientError } from "@/lib/analytics/client";

/** The root layout itself failed: a bare page in the app's dark theme, no stylesheet. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const locale = typeof window === "undefined" ? "en" : window.location.pathname.split("/")[1];
  const t = errorCopy(locale);
  useEffect(() => {
    reportClientError(error, "global-boundary");
  }, [error]);
  return (
    <html lang={locale in { en: 1, fr: 1, es: 1 } ? locale : "en"}>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          background: "#0b0f17",
          color: "#e6e9ef",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <title>EndzoneIQ</title>
        <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 16px" }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>{t.title}</h1>
          <p style={{ color: "#9aa3b2" }}>{t.body}</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              height: 40,
              padding: "0 16px",
              borderRadius: 6,
              border: "1px solid #2a3140",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            {t.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
