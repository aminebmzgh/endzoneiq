"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { errorCopy } from "@/components/error-copy";
import { reportClientError } from "@/lib/analytics/client";

/** A page failed to render: keep the header and footer, report, offer a retry. */
export default function LocaleError({ error, retry }: { error: unknown; retry: () => void }) {
  const params = useParams<{ locale?: string }>();
  const t = errorCopy(params?.locale);
  useEffect(() => {
    reportClientError(error, "boundary");
  }, [error]);
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:py-24">
      <h1 className="text-3xl font-bold tracking-tight text-balance">{t.title}</h1>
      <p className="mt-4 text-muted-foreground">{t.body}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground"
        >
          {t.retry}
        </button>
        <a
          href={`/${params?.locale ?? "en"}`}
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          {t.home}
        </a>
      </div>
    </div>
  );
}
