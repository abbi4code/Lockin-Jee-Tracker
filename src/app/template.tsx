"use client";

import { useState, type ReactNode } from "react";

let navigated = false;

/**
 * Re-mounts on every navigation, so each page fades in (CSS, so it never waits for scripts). The first page load
 * isn't faded: there's nothing to fade from, and starting invisible would hold back the first paint.
 */
export default function Template({ children }: { children: ReactNode }) {
  const [fade] = useState(() => {
    if (typeof window === "undefined") return false;
    const was = navigated;
    navigated = true;
    return was;
  });
  return <div className={fade ? "page-fade" : undefined}>{children}</div>;
}
