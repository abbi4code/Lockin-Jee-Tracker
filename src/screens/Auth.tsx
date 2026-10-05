"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { DotField } from "../components/DotField";
import { supabase } from "../lib/supabase/client";
import { useProgress } from "../store/progress";

const field = "w-full border-b border-line-2 bg-transparent py-3 text-[16px] outline-none transition-colors placeholder:text-dim focus:border-fg";

/** Where to go after signing in: ?next= if it's a path on this site, else the dashboard. */
function target() {
  const next = new URLSearchParams(window.location.search).get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/today";
}

// Known on the server too (unlike the browser client), so the server HTML already has the right form.
const ACCOUNTS = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function Form({ mode }: { mode: "signin" | "signup" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "link") setError("That link expired or was already used. Sign in instead.");
  }, []);

  if (!ACCOUNTS) {
    return (
      <div className="space-y-4">
        <p className="text-[15px] leading-relaxed text-mute">Accounts aren&apos;t set up yet: add the Supabase keys to .env. Until then everything is saved on this device.</p>
        <Link href="/today" className="inline-flex items-center gap-2 rounded-full bg-fg px-5 py-3 text-[15px] font-medium text-ink">
          open the app <ArrowRight className="size-4" />
        </Link>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const sb = supabase;
    if (!sb) return;
    setBusy(true);
    setError(null);
    if (mode === "signin") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
    } else {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { name }, emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(target())}` },
      });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      if (name) useProgress.getState().setSettings({ name });
      if (!data.session) {
        setSent(true);
        setBusy(false);
        return;
      }
    }
    // Full navigation so the proxy sees the new session cookie.
    window.location.assign(target());
  };

  if (sent) {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
        <p className="text-[22px] font-semibold tracking-tight">check your inbox.</p>
        <p className="text-[15px] leading-relaxed text-mute">
          We sent a confirmation link to <span className="text-fg">{email}</span>. Open it on this device and you&apos;re in.
        </p>
      </motion.div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      {mode === "signup" && <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} placeholder="your name" autoComplete="given-name" className={field} />}
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" autoComplete="email" className={field} />
      <input
        type="password"
        required
        minLength={6}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={mode === "signup" ? "password (6+ characters)" : "password"}
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        className={field}
      />
      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="pt-2 font-mono text-[13px] text-red">
            {error}
          </motion.p>
        )}
      </AnimatePresence>
      <div className="pt-6">
        <motion.button whileTap={{ scale: 0.98 }} disabled={busy} data-cursor="go" className="flex w-full items-center justify-center gap-2 rounded-full bg-fg py-3.5 text-[15px] font-medium text-ink transition disabled:opacity-60">
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : mode === "signin" ? "sign in" : "create account"}
        </motion.button>
      </div>
    </form>
  );
}

export function AuthScreen({ mode }: { mode: "signin" | "signup" }) {
  const switcher = (
    <p className="mt-8 text-center font-mono text-[13px] text-dim lg:text-left">
      {mode === "signin" ? (
        <>
          new here?{" "}
          <Link href="/signup" className="text-fg underline-offset-4 hover:underline">
            create an account
          </Link>
        </>
      ) : (
        <>
          have an account?{" "}
          <Link href="/login" className="text-fg underline-offset-4 hover:underline">
            sign in
          </Link>
        </>
      )}
    </p>
  );

  return (
    <main className="min-h-dvh lg:grid lg:grid-cols-2">
      {/* Laptops: a full-height dot-matrix panel on the left. */}
      <section className="relative hidden overflow-hidden border-r border-line lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <DotField className="absolute inset-0 size-full" accent />
        <Link href="/" className="dot relative w-fit text-xl">
          lockin.
        </Link>
        <div className="relative">
          <p className="font-mono text-[12px] tracking-[0.18em] text-mute uppercase">jee main + advanced · 2027</p>
          <p className="mt-5 text-[56px] leading-[1.02] font-semibold tracking-[-0.03em] xl:text-[72px]">
            Stop planning.
            <br />
            <span className="text-mute">Lock in.</span>
          </p>
        </div>
      </section>

      <section className="relative grid min-h-dvh grid-rows-[auto_1fr_auto] px-6 py-8 lg:px-12 xl:px-16">
        <DotField className="absolute inset-x-0 top-0 h-72 opacity-60 lg:hidden" />
        <Link href="/" className="dot relative w-fit text-lg lg:invisible">
          lockin.
        </Link>
        <div className="relative mx-auto w-full max-w-sm self-center lg:max-w-md">
          <h1 className="text-[32px] leading-tight font-semibold tracking-tight lg:text-[40px]">{mode === "signin" ? "welcome back." : "time to lock in."}</h1>
          <p className="mt-2 mb-8 text-[15px] text-mute">{mode === "signin" ? "Pick up exactly where you left off." : "Every chapter, topic and study minute — tracked."}</p>
          <Form mode={mode} />
          {switcher}
        </div>
        <p className="relative text-center font-mono text-[11px] text-dim">jee main + advanced 2027</p>
      </section>
    </main>
  );
}
