"use client";

import { Video } from "lucide-react";
import type { Invitee } from "../../lib/call/calls";
import { useCall } from "./CallProvider";

/**
 * Starts a video call from somewhere (a chat, a game). `context` names where the call belongs (see calls.ts) and
 * the database decides whether `invitees` may be called from it. Already in this call: brings the window back.
 * Hidden when calls aren't available (signed out, no accounts set up).
 */
export function CallButton({ context, invitees, label = "video call", variant = "pill", bordered = false }: { context: string; invitees: Invitee[]; label?: string; variant?: "pill" | "icon"; bordered?: boolean }) {
  const api = useCall();
  if (!api) return null;
  const s = api.state;
  const here = s.call?.context === context && s.phase !== "idle";
  const pending = s.busy && api.lastContext === context;
  const onClick = () => (here ? api.reveal() : api.start(context, invitees));
  const text = here ? (s.phase === "live" ? "in call" : "calling…") : pending ? "connecting…" : label;

  if (variant === "icon") {
    return (
      <button onClick={onClick} disabled={pending} aria-label={here ? "show the call" : label} title={here ? "show the call" : label} className={`relative grid size-9 shrink-0 place-items-center rounded-full transition disabled:opacity-50 ${bordered ? "border border-line-2 hover:border-fg" : "hover:bg-ink-2"} ${here ? "text-fg" : "text-mute hover:text-fg"}`}>
        <Video className={bordered ? "size-4" : "size-[18px]"} />
        {here && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-red" />}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={pending}
      data-cursor="go"
      className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-medium transition disabled:opacity-50 ${here ? "border border-line-2 text-fg" : "bg-fg text-ink"}`}
    >
      {here ? <span className="size-1.5 rounded-full bg-red" /> : <Video className="size-3.5" />} {text}
    </button>
  );
}
