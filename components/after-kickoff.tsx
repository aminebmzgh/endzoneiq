"use client";

import { type ReactNode, useEffect, useState } from "react";

/**
 * Shows `before` until kickoff and `after` from then on. Pages are cached as
 * static HTML, so anything that depends on the clock is decided in the browser.
 */
export function AfterKickoff({
  iso,
  before = null,
  after,
}: {
  iso: string;
  before?: ReactNode;
  after: ReactNode;
}) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const kickoff = Date.parse(iso);
    const check = () => setStarted(Date.now() >= kickoff);
    check();
    const wait = kickoff - Date.now();
    // Flip at kickoff if the page stays open (setTimeout caps at ~24.8 days).
    if (wait > 0 && wait < 2 ** 31 - 1) {
      const id = setTimeout(check, wait + 1000);
      return () => clearTimeout(id);
    }
  }, [iso]);
  return <>{started ? after : before}</>;
}
