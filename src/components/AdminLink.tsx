"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

// Asked once per app load; the answer only changes if ADMIN_EMAILS changes.
let cached: Promise<boolean> | null = null;
const isAdmin = () => (cached ??= fetch("/api/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { admin: false })).then((j: { admin?: boolean }) => !!j.admin).catch(() => false));

/** Shortcut to the admin panel, shown only to admin accounts. */
export function AdminLink() {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    isAdmin().then(setAdmin);
  }, []);
  if (!admin) return null;
  return (
    <Link href="/admin" className="flex items-center gap-1.5 rounded-full border border-red/50 px-3 py-1 font-mono text-[12.5px] text-red transition hover:border-red hover:bg-red hover:text-ink">
      <ShieldCheck className="size-3.5" /> admin
    </Link>
  );
}
