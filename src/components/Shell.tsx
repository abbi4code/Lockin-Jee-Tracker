"use client";

import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { Atom, FlaskConical, House, Sigma, Timer, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getChapter } from "../data";
import { Cursor } from "./Cursor";
import { ChatDock } from "./ChatDock";
import { FocusTimer } from "./FocusTimer";
import { startSync, useSync } from "../lib/sync";
import { useProgress } from "../store/progress";

const NAV = [
  { href: "/today", label: "Today", icon: House, color: "var(--color-fg)" },
  { href: "/s/physics", label: "Phy", icon: Atom, color: "var(--color-phy)" },
  { href: "/s/chemistry", label: "Chem", icon: FlaskConical, color: "var(--color-chem)" },
  { href: "/s/maths", label: "Math", icon: Sigma, color: "var(--color-math)" },
  { href: "/focus", label: "Focus", icon: Timer, color: "var(--color-red)" },
  { href: "/me", label: "Me", icon: UserRound, color: "var(--color-fg)" },
];

function Nav() {
  const { state } = useSync();
  const pathname = usePathname();
  // A chapter page lights up its subject's tab.
  const chapter = pathname.startsWith("/c/") ? getChapter(pathname.slice(3)) : undefined;
  const current = chapter ? `/s/${chapter.subject}` : pathname;

  return (
    // The strip spans the whole width; it lets clicks through so the chat button, timer pill and page
    // content underneath stay clickable. Only the pill itself takes clicks.
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),14px)]">
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 22, delay: 0.3 }}
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-line-2 bg-ink-2/85 p-1.5 shadow-[0_20px_60px_-12px_rgb(0_0_0/0.45)] backdrop-blur-xl lg:gap-2 lg:p-2"
      >
        {NAV.map(({ href, label, icon: Icon, color }) => {
          const isActive = current === href;
          return (
            <Link key={href} href={href} className="relative">
              <motion.div whileTap={{ scale: 0.88 }} className={`relative flex items-center gap-1.5 rounded-full px-3 py-2.5 text-[15px] font-medium transition-colors lg:gap-2 lg:px-5 ${isActive ? "text-ink" : "text-mute hover:text-fg"}`}>
                {isActive && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-full"
                    style={{ background: color, boxShadow: `0 0 28px -6px ${color}` }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <Icon className="relative size-[18px]" strokeWidth={2.4} />
                {/* Laptops have room: inactive tabs show their label too. */}
                {!isActive && <span className="relative hidden lg:inline">{label}</span>}
                <AnimatePresence initial={false}>
                  {isActive && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: "auto", opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      className="relative overflow-hidden whitespace-nowrap"
                    >
                      {label}
                    </motion.span>
                  )}
                </AnimatePresence>
                {href === "/me" && (state === "error" || state === "offline") && <span className="absolute top-1.5 right-2 size-1.5 rounded-full bg-warn" />}
              </motion.div>
            </Link>
          );
        })}
        {/* The secret: a barely-there dot at the end of the pill opens /extras. */}
        <Link href="/extras" aria-label="extras" className="group -ml-0.5 grid h-10 w-4 place-items-center lg:w-5">
          <span className={`size-1 rounded-full transition-colors ${pathname.startsWith("/extras") ? "bg-red" : "bg-dim/50 group-hover:bg-red"}`} />
        </Link>
      </motion.div>
    </nav>
  );
}

/** Landing, auth and admin pages are full-screen: no nav, no timer pill. */
const CHROMELESS = (path: string) => path === "/" || path === "/login" || path === "/signup" || path.startsWith("/admin") || path.startsWith("/auth");

/** Pages that never read saved progress: they render in the server HTML instead of waiting for the app to load. */
const INSTANT = (path: string) => path === "/" || path === "/login" || path === "/signup" || path.startsWith("/auth");

function AppChrome() {
  const pathname = usePathname();
  if (CHROMELESS(pathname)) return null;
  return (
    <>
      <FocusTimer />
      <ChatDock />
      <Nav />
    </>
  );
}

/** App chrome + client setup: loads saved progress, starts sync, registers the offline service worker. */
export function Providers({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const instant = INSTANT(usePathname());
  useEffect(() => {
    Promise.resolve(useProgress.persist.rehydrate()).then(() => {
      setReady(true);
      startSync();
    });
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(console.error);
      } else {
        // Dev: a worker left over from a production run on the same port would serve stale code. Remove it.
        navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
        caches?.keys().then((keys) => keys.filter((k) => k.startsWith("lockin-")).forEach((k) => caches.delete(k)));
      }
    }
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      {/* App pages depend on progress saved in this browser, so they render once it has loaded. */}
      {(ready || instant) && children}
      {ready && <AppChrome />}
      <Cursor />
    </MotionConfig>
  );
}

/** Page wrapper: a narrow column on phones, a wide canvas on laptops; sections fade in one after another. */
export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.main
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.04 } } }}
      className={`mx-auto w-full max-w-2xl px-5 pt-[max(env(safe-area-inset-top),24px)] pb-36 lg:max-w-[1500px] lg:px-12 lg:pt-10 xl:px-16 ${className}`}
    >
      {children}
    </motion.main>
  );
}
