"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Maximize2, Mic, MicOff, Minimize2, PhoneOff, Video, VideoOff } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { nameList, othersIn, type MemberRow, type Notice } from "../../lib/call/calls";
import type { Peer } from "../../lib/call/transport";
import { useChatOpen, useWide } from "../../lib/overlay";
import { buzz } from "../Controls";
import type { CallApi } from "./CallProvider";

// The call, floating over every page. Drag it by its top bar to any corner (remembered); make it bigger, or fold it
// into a pill. Voices play through their own <audio> elements, so folding the window never cuts anyone off.

type Corner = "tl" | "tr" | "bl" | "br";
const CORNER_KEY = "lockin-call-corner";
const POSITION: Record<Corner, string> = {
  tl: "top-[max(0.75rem,env(safe-area-inset-top))] left-3 lg:top-6 lg:left-6",
  tr: "top-[max(0.75rem,env(safe-area-inset-top))] right-3 lg:top-6 lg:right-6",
  // Above the nav pill on phones.
  bl: "bottom-[calc(6rem+env(safe-area-inset-bottom))] left-3 lg:bottom-6 lg:left-6",
  br: "bottom-[calc(6rem+env(safe-area-inset-bottom))] right-3 lg:bottom-6 lg:right-6",
};

const ENDED: Record<Notice, (names: string) => string> = {
  "no-answer": (n) => `${n || "they"} didn't pick up.`,
  declined: (n) => `${n || "they"} can't talk right now.`,
  left: () => "call ended.",
  moved: () => "the call moved to your other tab or device.",
  blocked: () => "camera and mic are blocked. allow them for this site in the browser, then try again.",
  "no-device": () => "no camera or mic found on this device.",
  failed: () => "the call couldn't connect. try again.",
};

function useCorner(): [Corner, (c: Corner) => void] {
  const [corner, setCorner] = useState<Corner>("tr");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CORNER_KEY) as Corner | null;
      if (saved && saved in POSITION) setCorner(saved);
    } catch {
      // Private mode: the window just starts top right.
    }
  }, []);
  const set = (c: Corner) => {
    setCorner(c);
    try {
      localStorage.setItem(CORNER_KEY, c);
    } catch {
      // Not remembered; fine.
    }
  };
  return [corner, set];
}

/** A stream in a <video>, always muted: voices go through PeerAudio. Your own preview is mirrored. */
function StreamVideo({ stream, mirror = false, hidden = false }: { stream: MediaStream | null; mirror?: boolean; hidden?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (v && v.srcObject !== stream) v.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={`size-full object-cover ${hidden ? "invisible" : ""}`} style={mirror ? { transform: "scaleX(-1)" } : undefined} />;
}

function PeerAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (a && a.srcObject !== stream) a.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

function Tile({ name, stream, cam, mic, status, mirror = false, className = "" }: { name: string; stream: MediaStream | null; cam: boolean; mic: boolean; status: string | null; mirror?: boolean; className?: string }) {
  const showVideo = !!stream?.getVideoTracks().length && cam && !status;
  return (
    <div className={`relative overflow-hidden rounded-md border border-line-2 bg-ink ${className}`}>
      <StreamVideo stream={stream} mirror={mirror} hidden={!showVideo} />
      {!showVideo && (
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="dot text-[clamp(20px,5vw,40px)] leading-none text-mute uppercase">{name.slice(0, 1) || "?"}</div>
            <div className="mt-1.5 font-mono text-[11px] text-dim">{status ?? "camera off"}</div>
          </div>
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-0.75rem)] items-center gap-1 rounded-full bg-ink/70 px-2 py-0.5 font-mono text-[11px] text-fg backdrop-blur">
        {!mic && <MicOff aria-label="muted" className="size-3 shrink-0 text-red" />}
        <span className="truncate">{name}</span>
      </div>
    </div>
  );
}

const iconButton = "grid size-10 place-items-center rounded-full border transition";
const headerButton = "grid size-7 place-items-center rounded-full text-mute transition hover:bg-ink-3 hover:text-fg";

/** Where the window sits while the chat sheet is open: off its side panel on a laptop, above its sheet on a phone. */
const clearOfChat = (c: Corner, wide: boolean): Corner => (wide ? (c === "tr" ? "tl" : c === "br" ? "bl" : c) : "tl");

export function CallWindow({ api }: { api: CallApi }) {
  const s = api.state;
  const [corner, setCorner] = useCorner();
  const [large, setLarge] = useState(false);
  const [folded, setFolded] = useState(false);
  const chatOpen = useChatOpen();
  const wide = useWide();
  // The chat sheet takes the right side (laptop) or nearly the whole screen (phone): step out of its way, folded on a
  // phone so it fits above the sheet. Your own corner and size come back when the chat closes.
  const at = chatOpen ? clearOfChat(corner, wide) : corner;
  const small = folded || (chatOpen && !wide);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  /** Where the window was dropped, so the move to its corner can start from there (and a tick to replay it). */
  const dropped = useRef<DOMRect | null>(null);
  const [drops, setDrops] = useState(0);
  const lastNames = useRef("");

  // A button elsewhere asking for the call brings the window back.
  useEffect(() => setFolded(false), [api.revealed]);

  const others: MemberRow[] = othersIn(s.members, api.me);
  const ringing = s.members.filter((m) => m.user_id !== api.me && m.state === "ringing");
  const names = nameList((s.phase === "live" ? others : ringing).map((m) => m.name));
  if (names) lastNames.current = names;

  // After a call: a line saying how it ended, for a few seconds.
  const ended = s.phase === "idle" && !s.busy && (s.notice || s.error) ? (s.error ?? ENDED[s.notice!](lastNames.current)) : null;
  const { clearNotice } = api;
  useEffect(() => {
    if (!ended) return;
    const t = setTimeout(clearNotice, 6000);
    return () => clearTimeout(t);
  }, [ended, clearNotice]);

  const open = s.phase !== "idle" || s.busy;
  const peerOf = (user: string): Peer | undefined => s.peers.find((p) => p.user === user);
  const title = s.busy && s.phase === "idle" ? "connecting…" : s.phase === "calling" ? `calling ${names || "…"}` : names || "call";

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !box.current) return;
    box.current.style.transform = `translate(${e.clientX - drag.current.x}px, ${e.clientY - drag.current.y}px)`;
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !box.current) return;
    const moved = Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) > 8;
    drag.current = null;
    if (!moved) {
      box.current.style.transform = "";
      return;
    }
    // Snap to the corner nearest the window's middle where it was dropped (not the pointer: a tall window's top bar
    // can be in the top half while the window is plainly at the bottom).
    const r = box.current.getBoundingClientRect();
    dropped.current = r;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    setCorner(`${cy < window.innerHeight / 2 ? "t" : "b"}${cx < window.innerWidth / 2 ? "l" : "r"}` as Corner);
    setDrops((n) => n + 1);
    buzz(6);
  };

  // Glide from the drop point to the corner (FLIP): measure the corner position, start from where it was dropped,
  // then let the transform run back to zero. Runs before paint, so it never flicks back to the old corner first.
  useLayoutEffect(() => {
    const el = box.current;
    const from = dropped.current;
    if (!el || !from) return;
    dropped.current = null;
    el.style.transition = "none";
    el.style.transform = "";
    const to = el.getBoundingClientRect();
    el.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px)`;
    void el.offsetWidth;
    el.style.transition = "transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)";
    el.style.transform = "";
  }, [drops]);

  const controls = (
    <div className="flex items-center justify-center gap-2">
      <button onClick={api.toggleMic} aria-label={s.mic ? "mute your mic" : "unmute your mic"} aria-pressed={!s.mic} className={`${iconButton} ${s.mic ? "border-line-2 text-mute hover:border-fg hover:text-fg" : "border-red text-red"}`}>
        {s.mic ? <Mic className="size-4" /> : <MicOff className="size-4" />}
      </button>
      {s.local?.getVideoTracks().length ? (
        <button onClick={api.toggleCam} aria-label={s.cam ? "turn your camera off" : "turn your camera on"} aria-pressed={!s.cam} className={`${iconButton} ${s.cam ? "border-line-2 text-mute hover:border-fg hover:text-fg" : "border-red text-red"}`}>
          {s.cam ? <Video className="size-4" /> : <VideoOff className="size-4" />}
        </button>
      ) : null}
      <button onClick={api.leave} aria-label="hang up" data-cursor="danger" className={`${iconButton} border-red text-red hover:bg-red hover:text-ink`}>
        <PhoneOff className="size-4" />
      </button>
    </div>
  );

  const me = <Tile name="you" stream={s.local} cam={s.cam} mic={s.mic} status={null} mirror />;
  const remote = (m: MemberRow) => {
    const p = peerOf(m.user_id);
    const status = !p || p.status === "connecting" ? "connecting…" : p.status === "reconnecting" ? "reconnecting…" : null;
    return <Tile key={m.user_id} name={p?.name || m.name || "someone"} stream={p?.stream ?? null} cam={p?.cam ?? true} mic={p?.mic ?? true} status={status} className="aspect-[4/3]" />;
  };

  return (
    <>
      {/* Voices, whatever the window looks like. */}
      {s.peers.map((p) => (
        <PeerAudio key={p.sid} stream={p.stream} />
      ))}

      <AnimatePresence>
        {open && (
          <motion.div
            ref={box}
            key="call"
            // Fades only: the window's transform belongs to dragging and the glide to a corner (see above).
            role="dialog"
            aria-label="call"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={`fixed z-[80] ${POSITION[at]} ${small ? "w-auto" : large ? "w-[calc(100vw-1.5rem)] max-w-[34rem] lg:w-[34rem]" : "w-[min(15rem,calc(100vw-1.5rem))] lg:w-72"}`}
          >
            <div className="overflow-hidden rounded-2xl border border-line-2 bg-ink-2/95 shadow-[0_24px_70px_-16px_rgb(0_0_0/0.6)] backdrop-blur-xl">
              <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => drag.current && box.current && ((box.current.style.transform = ""), (drag.current = null))} className="flex cursor-grab touch-none items-center gap-2 py-1.5 pr-1.5 pl-3 select-none active:cursor-grabbing">
                <span className={`size-1.5 shrink-0 rounded-full bg-red ${s.phase === "live" ? "" : "animate-pulse"}`} />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{title}</span>
                {small ? (
                  <>
                    <button onClick={api.toggleMic} aria-label={s.mic ? "mute your mic" : "unmute your mic"} className={`${headerButton} ${s.mic ? "" : "text-red"}`}>
                      {s.mic ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
                    </button>
                    <button onClick={api.leave} aria-label="hang up" className={`${headerButton} text-red hover:text-red`}>
                      <PhoneOff className="size-3.5" />
                    </button>
                    <button onClick={() => setFolded(false)} aria-label="open the call" className={headerButton}>
                      <Maximize2 className="size-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setLarge((v) => !v)} aria-label={large ? "make the call smaller" : "make the call bigger"} className={headerButton}>
                      {large ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                    </button>
                    <button onClick={() => setFolded(true)} aria-label="fold the call away" className={headerButton}>
                      <ChevronDown className="size-4" />
                    </button>
                  </>
                )}
              </div>

              {!small && (
                <div className="space-y-2.5 px-2 pb-2.5">
                  {s.phase === "live" && others.length === 1 ? (
                    // One other person: they fill the window, you're in the corner.
                    <div className="relative">
                      {remote(others[0])}
                      <div className="absolute right-1.5 bottom-1.5 aspect-[4/3] w-[32%]">{me}</div>
                    </div>
                  ) : s.phase === "live" ? (
                    <div className={`grid gap-1.5 ${others.length + 1 <= 4 ? "grid-cols-2" : "grid-cols-3"}`}>
                      {others.map(remote)}
                      <div className="aspect-[4/3]">{me}</div>
                    </div>
                  ) : (
                    // Ringing (or joining): your own preview while you wait.
                    <div className="relative aspect-[4/3]">{me}</div>
                  )}
                  {controls}
                </div>
              )}
            </div>
          </motion.div>
        )}
        {!open && ended && (
          <motion.div key="ended" role="status" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`fixed z-[80] ${POSITION[at]} max-w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-line-2 bg-ink-2/95 px-4 py-3 font-mono text-[12.5px] text-mute backdrop-blur-xl`}>
            {ended}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
