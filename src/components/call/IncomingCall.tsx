"use client";

import { AnimatePresence, motion } from "motion/react";
import { Video } from "lucide-react";
import { useEffect } from "react";
import { contextKind } from "../../lib/call/calls";
import { chime } from "../../lib/chime";
import { buzz } from "../Controls";
import type { CallApi } from "./CallProvider";

const FROM: Record<string, string> = { chess: "from your chess game", skribbl: "from skribbl" };

/** Rings (sound and buzz) every few seconds while a call is coming in. */
function useRinging(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const ring = () => {
      chime();
      buzz(40);
    };
    ring();
    const t = setInterval(ring, 4000);
    return () => clearInterval(t);
  }, [on]);
}

const bar = "pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-line-2 bg-ink-2/95 py-2.5 pr-2.5 pl-4 shadow-[0_20px_60px_-12px_rgb(0_0_0/0.55)] backdrop-blur-xl";

/** "anu is calling · join / not now", on top of any page; or a way back into a call you dropped out of. */
export function IncomingCall({ api }: { api: CallApi }) {
  useRinging(!!api.ring);
  const kind = api.ring ? contextKind(api.ring.context) : null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[90] flex justify-center px-4">
      <AnimatePresence>
        {api.ring ? (
          <motion.div key={api.ring.call} role="alertdialog" aria-label={`${api.ring.from} is calling`} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.22 }} className={bar}>
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-red" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] text-fg">{api.ring.from} is calling</div>
              <div className="font-mono text-[11.5px] text-mute">video call{kind ? ` ${FROM[kind]}` : ""}</div>
            </div>
            <button onClick={api.decline} className="rounded-full px-3 py-2 text-[13.5px] text-mute transition hover:text-fg">
              not now
            </button>
            <button onClick={api.accept} disabled={api.state.busy} data-cursor="go" className="flex items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink disabled:opacity-50">
              <Video className="size-3.5" /> join
            </button>
          </motion.div>
        ) : api.rejoin ? (
          <motion.div key={`rejoin-${api.rejoin.call}`} role="status" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.22 }} className={bar}>
            <span className="size-2 shrink-0 rounded-full bg-red" />
            <div className="min-w-0 flex-1 text-[14.5px] text-fg">your call is still going</div>
            <button onClick={api.dismissRejoin} className="rounded-full px-3 py-2 text-[13.5px] text-mute transition hover:text-fg">
              leave it
            </button>
            <button onClick={api.rejoinNow} disabled={api.state.busy} data-cursor="go" className="rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink disabled:opacity-50">
              rejoin
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
