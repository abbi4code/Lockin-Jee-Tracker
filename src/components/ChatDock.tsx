"use client";

import { AnimatePresence, motion, useDragControls, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { ArrowLeft, ArrowUp, ArrowUpRight, BellRing, Check, CheckCheck, Clock3, Copy, MessageCircle, Reply, SmilePlus, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { getChapter } from "../data";
import { useChatUser, useThread, useUnread, type Message } from "../lib/chat";
import { coachName, listThreads, type ThreadSummary } from "../lib/chat-actions";
import { lastSeenLabel, startPresence, useOnlineIds, useOtherStatus } from "../lib/presence";
import { currentSubscription, enablePush, isInstalled, isIOS, pushSupported } from "../lib/push-client";
import { setChatOpen } from "../lib/overlay";
import { supabase } from "../lib/supabase/client";
import { CallButton } from "./call/CallButton";
import { buzz } from "./Controls";
import { Label } from "./ui";

const QUICK_REPLIES = ["how's today going?", "logged today's test?", "proud of you 🔥", "take a 10 min break"];
const REACTIONS = ["👍", "❤️", "😂", "🔥", "💀", "🙏"];
/** How far (px) a bubble has to be swiped right to reply. */
const SWIPE = 56;
const LONG_PRESS_MS = 420;

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "today";
  if (d.toDateString() === y.toDateString()) return "yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
function ago(iso: string | null) {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

/** Reaction picker: a row of emoji plus reply / copy. Opens on long-press (phones) or the smiley button (mouse). */
function ReactionBar({ mine, below, current, onPick, onReply, onCopy }: { mine: boolean; below: boolean; current: string | null; onPick: (e: string | null) => void; onReply: () => void; onCopy: () => void }) {
  return (
    <motion.div
      data-reaction-bar
      initial={{ opacity: 0, scale: 0.9, y: below ? -4 : 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 600, damping: 34 }}
      className={`absolute z-30 flex items-center gap-0.5 rounded-full border border-line-2 bg-ink-2 p-1 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.6)] ${below ? "top-full mt-2" : "bottom-full mb-2"} ${
        mine ? "right-0 origin-bottom-right" : "left-0 origin-bottom-left"
      }`}
    >
      {REACTIONS.map((e) => (
        <motion.button
          key={e}
          whileTap={{ scale: 0.8 }}
          onClick={() => onPick(current === e ? null : e)}
          aria-label={current === e ? `remove ${e}` : `react ${e}`}
          className={`grid size-8 place-items-center rounded-full text-[19px] leading-none transition-colors hover:bg-ink-3 ${current === e ? "bg-ink-3 ring-1 ring-line-2" : ""}`}
        >
          {e}
        </motion.button>
      ))}
      <span className="mx-0.5 h-5 w-px bg-line-2" />
      <button onClick={onReply} aria-label="reply" className="grid size-8 place-items-center rounded-full text-mute transition-colors hover:bg-ink-3 hover:text-fg">
        <Reply className="size-4" />
      </button>
      <button onClick={onCopy} aria-label="copy" className="grid size-8 place-items-center rounded-full text-mute transition-colors hover:bg-ink-3 hover:text-fg">
        <Copy className="size-4" />
      </button>
    </motion.div>
  );
}

/** On my messages: a clock while sending, ✓ sent, ✓✓ delivered (reached their app or phone), red ✓✓ read. Floated, so it
 * sits at the end of the last line, or bottom-right on a line of its own when the text fills the last one. */
function Ticks({ m }: { m: Message }) {
  if (m.failed) return null;
  const state = m.pending ? "sending" : m.read_at ? "read" : m.delivered_at ? "delivered" : "sent";
  const Icon = state === "sending" ? Clock3 : state === "sent" ? Check : CheckCheck;
  return (
    <span role="img" aria-label={state} title={state} className={`float-right mt-[5px] ml-2 -mr-0.5 inline-flex transition-colors duration-300 ${state === "read" ? "text-red" : "text-ink/45"}`}>
      <Icon className={state === "sending" ? "size-[13px]" : "size-[15px]"} strokeWidth={2.4} />
    </span>
  );
}

interface BubbleProps {
  m: Message;
  meId: string;
  mine: boolean;
  showTime: boolean;
  /** The message this one replies to: undefined = not a reply, null = older than what's loaded. */
  quoted: Message | null | undefined;
  quotedName: string;
  /** Phones: swipe right to reply. */
  swipe: boolean;
  picker: { below: boolean } | null;
  flash: boolean;
  onRetry: () => void;
  onReply: () => void;
  onPicker: (anchor: HTMLElement) => void;
  onReact: (emoji: string | null) => void;
  onCopy: () => void;
  onJump: () => void;
}

function Bubble({ m, meId, mine, showTime, quoted, quotedName, swipe, picker, flash, onRetry, onReply, onPicker, onReact, onCopy, onJump }: BubbleProps) {
  const chapter = m.chapter_id ? getChapter(m.chapter_id) : null;
  const anchor = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const hint = useTransform(x, [0, SWIPE], [0, 1]);
  // The reply icon trails just behind the bubble's left edge as it slides right.
  const hintX = useTransform(x, (v) => v - 34);
  const armed = useRef(false);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const live = !m.pending && !m.failed;
  const myReaction = m.reactions?.[meId] ?? null;
  const reactions = Object.values(m.reactions ?? {});
  const emojis = [...new Set(reactions)];

  // A small buzz as the swipe crosses the reply threshold, like WhatsApp.
  useMotionValueEvent(x, "change", (v) => {
    if (v >= SWIPE && !armed.current) {
      armed.current = true;
      buzz(8);
    } else if (v < SWIPE) armed.current = false;
  });

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);
  const startPress = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse" || !live) return;
    const { clientX, clientY } = e;
    press.current = {
      x: clientX,
      y: clientY,
      timer: setTimeout(() => {
        press.current = null;
        buzz(12);
        if (anchor.current) onPicker(anchor.current);
      }, LONG_PRESS_MS),
    };
  };
  const movePress = (e: ReactPointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) cancelPress();
  };

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: m.pending ? 0.6 : 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 36 }}
      style={{ zIndex: picker ? 20 : undefined }}
      className={`group relative flex flex-col ${mine ? "items-end" : "items-start"}`}
    >
      <div ref={anchor} className="relative max-w-[82%]">
        {/* Revealed by the swipe. */}
        {swipe && (
          <motion.span style={{ x: hintX, opacity: hint, scale: hint }} className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-mute">
            <span className="grid size-7 place-items-center rounded-full bg-ink-2">
              <Reply className="size-3.5" />
            </span>
          </motion.span>
        )}
        {/* Mouse: hover shows react / reply beside the bubble. */}
        {live && (
          <div data-reaction-bar className={`absolute inset-y-0 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:hidden ${mine ? "right-full mr-1.5" : "left-full ml-1.5"}`}>
            <button onClick={() => anchor.current && onPicker(anchor.current)} aria-label="react" className="grid size-7 place-items-center rounded-full text-dim transition-colors hover:bg-ink-2 hover:text-fg">
              <SmilePlus className="size-4" />
            </button>
            <button onClick={onReply} aria-label="reply" className="grid size-7 place-items-center rounded-full text-dim transition-colors hover:bg-ink-2 hover:text-fg">
              <Reply className="size-4" />
            </button>
          </div>
        )}
        <motion.div
          drag={swipe && live ? "x" : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={{ left: 0, right: 0.6 }}
          dragDirectionLock
          onDragStart={cancelPress}
          onDragEnd={() => armed.current && onReply()}
          style={{ x }}
          onPointerDown={startPress}
          onPointerMove={movePress}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onContextMenu={(e) => swipe && e.preventDefault()}
          className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
        >
          <div
            className={`rounded-2xl px-3.5 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap transition-[outline-color] duration-500 [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none ${
              mine ? "rounded-br-md bg-fg text-ink" : "rounded-bl-md border border-line-2 text-fg"
            } ${flash ? "outline-2 outline-offset-2 outline-red/70" : "outline-2 outline-offset-2 outline-transparent"}`}
          >
            {quoted !== undefined && (
              <button
                onClick={onJump}
                className={`mb-1.5 block w-full min-w-32 rounded-lg border-l-2 px-2.5 py-1.5 text-left ${mine ? "border-ink/40 bg-ink/10" : "border-mute bg-ink-2"}`}
              >
                <span className={`block font-mono text-[11px] ${mine ? "text-ink/70" : "text-mute"}`}>{quotedName}</span>
                <span className={`line-clamp-2 text-[13.5px] ${mine ? "text-ink/80" : "text-mute"}`}>{quoted ? quoted.body : "an earlier message"}</span>
              </button>
            )}
            {chapter && (
              <Link href={`/c/${chapter.id}`} className={`mb-1.5 flex items-center gap-1 font-mono text-[11px] underline-offset-2 hover:underline ${mine ? "text-ink/70" : "text-mute"}`}>
                <ArrowUpRight className="size-3" /> {chapter.name}
              </Link>
            )}
            {m.body}
            {mine && <Ticks m={m} />}
          </div>
          <AnimatePresence initial={false}>
            {emojis.length > 0 && (
              <motion.button
                data-reaction-bar
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: "spring", stiffness: 600, damping: 30 }}
                onClick={() => (myReaction ? onReact(null) : anchor.current && onPicker(anchor.current))}
                aria-label={myReaction ? `remove your ${myReaction}` : "react"}
                className={`relative z-10 -mt-1.5 flex items-center gap-0.5 rounded-full border border-line-2 bg-ink-2 px-1.5 py-0.5 text-[13px] leading-none ${mine ? "mr-2" : "ml-2"}`}
              >
                {emojis.map((e) => (
                  <span key={e}>{e}</span>
                ))}
                {reactions.length > 1 && <span className="ml-0.5 font-mono text-[10.5px] text-mute">{reactions.length}</span>}
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
        <AnimatePresence>
          {picker && (
            <ReactionBar mine={mine} below={picker.below} current={myReaction} onPick={onReact} onReply={onReply} onCopy={onCopy} />
          )}
        </AnimatePresence>
      </div>
      {m.failed ? (
        <button onClick={onRetry} className="mt-1 font-mono text-[11px] text-red">
          not sent · tap to retry
        </button>
      ) : (
        showTime && <span className="mt-1 font-mono text-[10.5px] text-dim">{time(m.created_at)}</span>
      )}
    </motion.div>
  );
}

const PROMPT_KEY = "lockin-chat-notify-dismissed";

/** Asks to turn on push for this device, so messages arrive while the app is closed. Hidden once on or dismissed. */
function NotifyPrompt() {
  const [mode, setMode] = useState<"ask" | "install" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (localStorage.getItem(PROMPT_KEY)) return;
    } catch {
      // Private mode: just ask.
    }
    if (isIOS() && !isInstalled()) return setMode("install");
    if (!pushSupported() || Notification.permission === "denied" || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
    currentSubscription()
      .then((s) => !s && setMode("ask"))
      .catch(() => {});
  }, []);
  const dismiss = () => {
    try {
      localStorage.setItem(PROMPT_KEY, "1");
    } catch {
      // Private mode: it comes back next time.
    }
    setMode(null);
  };
  const turnOn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await enablePush();
      buzz(12);
      setMode(null);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!mode) return null;
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
      <BellRing className="size-3.5 shrink-0 text-mute" />
      <p className="min-w-0 flex-1 font-mono text-[12px] leading-snug text-mute">
        {msg ?? (mode === "install" ? "add lockin. to your home screen to get message notifications" : "get a notification when a message lands")}
      </p>
      {mode === "ask" && (
        <button onClick={turnOn} disabled={busy} data-cursor="go" className="shrink-0 rounded-full bg-fg px-3 py-1 text-[12.5px] font-medium text-ink disabled:opacity-60">
          {busy ? "…" : "turn on"}
        </button>
      )}
      <button onClick={dismiss} aria-label="dismiss" className="grid size-6 shrink-0 place-items-center rounded-full text-dim transition-colors hover:text-fg">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function Thread({
  studentId,
  meId,
  isAdmin,
  otherName,
  keyboard,
  onTyping,
}: {
  studentId: string;
  meId: string;
  isAdmin: boolean;
  otherName: string;
  keyboard: boolean;
  /** The other side's typing state, for the header. */
  onTyping: (typing: boolean) => void;
}) {
  const { messages, loading, otherTyping, send, retry, react, markRead, typing } = useThread(studentId, meId);
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [picker, setPicker] = useState<{ id: string; below: boolean } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [swipe] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pathname = usePathname();
  const context = pathname.startsWith("/c/") ? getChapter(pathname.slice(3)) : null;
  const byId = new Map(messages.map((m) => [m.id, m]));
  const nameOf = (m: Message) => (m.sender_id === meId ? "you" : otherName);

  // Scrolls only the message list (scrollIntoView would also scroll the page behind the sheet on iPhone).
  const toEnd = useCallback((smooth: boolean) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);
  // Keep the newest message in view when one arrives (not when a reaction changes an old one).
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    toEnd(messages.length > 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, otherTyping, toEnd]);
  // The keyboard opening shrinks the list: stay at the bottom.
  useEffect(() => toEnd(false), [keyboard, toEnd]);
  // Mark what we've seen as read: when messages arrive while looking, and when coming back to the open chat
  // (messages that arrived while the app was in the background).
  useEffect(() => {
    if (document.visibilityState === "visible") markRead();
    const onVisible = () => document.visibilityState === "visible" && markRead();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [messages, markRead]);
  useEffect(() => {
    onTyping(otherTyping);
  }, [otherTyping, onTyping]);
  useEffect(() => () => onTyping(false), [onTyping]);

  // The picker closes on a tap anywhere else (its own buttons and the react/reply toggles handle themselves), or Escape (which then doesn't close the whole chat).
  useEffect(() => {
    if (!picker) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.("[data-reaction-bar]")) setPicker(null);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setPicker(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [picker]);

  const openPicker = (id: string, anchorEl: HTMLElement) => {
    const box = scroller.current?.getBoundingClientRect();
    // Not enough room above (first messages): open below the bubble instead.
    const below = !!box && anchorEl.getBoundingClientRect().top - box.top < 64;
    setPicker((p) => (p?.id === id ? null : { id, below }));
  };
  const startReply = (m: Message) => {
    setPicker(null);
    setReplyTo(m);
    input.current?.focus();
  };
  const jumpTo = (id: string) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-mid="${id}"]`);
    if (!el || !scroller.current) return;
    scroller.current.scrollTo({ top: el.offsetTop - scroller.current.clientHeight / 3, behavior: "smooth" });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1200);
  };

  const submit = (body = text) => {
    if (!body.trim()) return;
    buzz(10);
    send(body, attach && context ? context.id : null, replyTo?.id ?? null);
    setText("");
    setAttach(false);
    setReplyTo(null);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape" && replyTo) {
      e.stopPropagation();
      setReplyTo(null);
    }
  };
  // Grow with the text where the browser can't do it in CSS (field-sizing).
  useEffect(() => {
    const el = input.current;
    if (!el || CSS.supports("field-sizing", "content")) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [text]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="no-scrollbar relative min-h-0 flex-1 space-y-1.5 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4">
        {loading ? (
          <p className="py-10 text-center font-mono text-[12px] text-dim">loading…</p>
        ) : messages.length === 0 ? (
          <p className="mx-auto max-w-64 py-12 text-center text-[14px] leading-relaxed text-mute">
            {isAdmin ? "No messages yet. Say something encouraging." : "Ask a doubt, share a win, or rant about rotation. It all lands here."}
          </p>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const mine = m.sender_id === meId;
            const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
            const gapToNext = next ? new Date(next.created_at).getTime() - new Date(m.created_at).getTime() : Infinity;
            const showTime = !next || next.sender_id !== m.sender_id || gapToNext > 5 * 60_000;
            const quoted = m.reply_to ? (byId.get(m.reply_to) ?? null) : undefined;
            const hasReactions = Object.keys(m.reactions ?? {}).length > 0;
            return (
              <div key={m.id} data-mid={m.id}>
                {newDay && (
                  <div className="my-4 flex items-center gap-3">
                    <span className="h-px flex-1 bg-line" />
                    <Label>{dayLabel(m.created_at)}</Label>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <div className={`${!prev || prev.sender_id !== m.sender_id ? "pt-1.5" : ""} ${hasReactions ? "pb-1" : ""}`}>
                  <Bubble
                    m={m}
                    meId={meId}
                    mine={mine}
                    showTime={showTime}
                    quoted={quoted}
                    quotedName={quoted ? nameOf(quoted) : ""}
                    swipe={swipe}
                    picker={picker?.id === m.id ? picker : null}
                    flash={flash === m.id}
                    onRetry={() => retry(m)}
                    onReply={() => startReply(m)}
                    onPicker={(el) => openPicker(m.id, el)}
                    onReact={(e) => {
                      buzz(8);
                      setPicker(null);
                      react(m, e);
                    }}
                    onCopy={() => {
                      navigator.clipboard?.writeText(m.body).catch(() => {});
                      buzz(8);
                      setPicker(null);
                    }}
                    onJump={() => m.reply_to && jumpTo(m.reply_to)}
                  />
                </div>
              </div>
            );
          })
        )}
        <AnimatePresence>
          {otherTyping && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex w-fit gap-1 rounded-2xl rounded-bl-md border border-line-2 px-3.5 py-3">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="size-1.5 rounded-full bg-mute" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* With the keyboard up, the home-indicator padding would leave a gap above it. */}
      <div className={`shrink-0 border-t border-line px-3 pt-2.5 ${keyboard ? "pb-2.5" : "pb-[max(env(safe-area-inset-bottom),12px)]"}`}>
        <AnimatePresence initial={false}>
          {replyTo && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
              <div className="mb-2 flex items-center gap-3 rounded-xl border border-line-2 bg-ink-2 py-2 pr-1.5 pl-3">
                <Reply className="size-4 shrink-0 text-mute" />
                <div className="min-w-0 flex-1 border-l-2 border-mute pl-2.5">
                  <Label>replying to {nameOf(replyTo)}</Label>
                  <div className="truncate text-[13.5px] text-mute">{replyTo.body}</div>
                </div>
                <button onClick={() => setReplyTo(null)} aria-label="cancel reply" className="grid size-8 shrink-0 place-items-center rounded-full text-dim transition-colors hover:text-fg">
                  <X className="size-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {(context || isAdmin) && (
          <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
            {context && (
              <button
                onClick={() => setAttach((a) => !a)}
                className={`shrink-0 rounded-full border px-3 py-1 font-mono text-[11px] transition ${attach ? "border-fg bg-fg text-ink" : "border-line-2 text-mute hover:text-fg"}`}
              >
                {attach ? "✓ " : "+ "}
                {context.name}
              </button>
            )}
            {isAdmin &&
              QUICK_REPLIES.map((q) => (
                <button key={q} onClick={() => submit(q)} className="shrink-0 rounded-full border border-line-2 px-3 py-1 font-mono text-[11px] text-mute transition hover:border-fg hover:text-fg">
                  {q}
                </button>
              ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          {/* 16px on phones: iPhones zoom the whole page into any smaller text field when it's focused. */}
          <textarea
            ref={input}
            value={text}
            onChange={(e) => {
              setText(e.target.value.slice(0, 4000));
              typing();
            }}
            onKeyDown={onKey}
            rows={1}
            placeholder={replyTo ? "reply" : "message"}
            className="max-h-32 min-h-[42px] min-w-0 flex-1 resize-none rounded-[21px] border border-line-2 bg-transparent px-4 py-2.5 text-[16px] leading-snug outline-none [field-sizing:content] placeholder:text-dim focus:border-mute lg:text-[15px]"
          />
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => submit()}
            disabled={!text.trim()}
            aria-label="send"
            className="grid size-[42px] shrink-0 place-items-center rounded-full bg-fg text-ink transition disabled:opacity-30"
          >
            <ArrowUp className="size-5" strokeWidth={2.5} />
          </motion.button>
        </div>
      </div>
    </div>
  );
}

function Inbox({ onPick, refreshKey }: { onPick: (t: ThreadSummary) => void; refreshKey: number }) {
  const online = useOnlineIds();
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listThreads()
      .then(setThreads)
      .catch((e: Error) => setError(e.message));
  }, [refreshKey]);
  if (error) return <p className="p-6 font-mono text-[12px] text-red">{error}</p>;
  if (!threads) return <p className="py-10 text-center font-mono text-[12px] text-dim">loading…</p>;
  if (!threads.length) return <p className="p-8 text-center text-[14px] text-mute">No students yet. Once your brother signs up, his chat shows up here.</p>;
  return (
    <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {threads.map((t) => (
        <button key={t.studentId} onClick={() => onPick(t)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-ink-2">
          <span className="relative grid size-9 shrink-0 place-items-center rounded-full border border-line-2 font-mono text-[13px] uppercase">
            {t.name.slice(0, 1)}
            {online.has(t.studentId) && <span aria-label="online" className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-ink bg-red" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className={`truncate text-[15px] ${t.unread ? "font-semibold" : ""}`}>{t.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-dim">{ago(t.lastAt)}</span>
            </span>
            <span className={`block truncate text-[13px] ${t.unread ? "text-fg" : "text-mute"}`}>{t.lastBody ? `${t.lastFromStudent ? "" : "you: "}${t.lastBody}` : "no messages yet"}</span>
          </span>
          {t.unread > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-red px-1.5 font-mono text-[11px] text-ink">{t.unread}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Phones don't shrink the page for the on-screen keyboard: it covers fixed elements, and the browser shifts the
 * page to show the text field (pushing the chat header off-screen). While the keyboard is up, this returns the
 * area still visible so the sheet can sit exactly inside it. Null when there's no keyboard (or on laptops).
 */
function useKeyboardArea(active: boolean) {
  const [area, setArea] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const laptop = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      const covered = document.documentElement.clientHeight - vv.height;
      // Pinch-zoom and the URL bar also change the visible height; only a keyboard-sized gap counts.
      setArea(!laptop.matches && vv.scale < 1.01 && covered > 120 ? { top: vv.offsetTop, height: vv.height } : null);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setArea(null);
    };
  }, [active]);
  return area;
}

/**
 * Floating chat. Students get their thread with the coach; admins get an inbox of students first.
 * placement="app" sits above the nav on phones; "admin" sits in the corner (admin pages have no nav).
 */
export function ChatDock({ placement = "app", openStudentId, openStudentName = "" }: { placement?: "app" | "admin"; openStudentId?: string; openStudentName?: string }) {
  const { user, isAdmin } = useChatUser();
  const [otherTyping, setOtherTyping] = useState(false);
  useEffect(() => {
    if (user && isAdmin !== null) startPresence(user.id, isAdmin);
  }, [user, isAdmin]);
  const drag = useDragControls();
  const unread = useUnread(user?.id ?? null, isAdmin);
  const [open, setOpen] = useState(false);
  // The call window keeps clear of the open sheet.
  useEffect(() => {
    setChatOpen(open);
    return () => setChatOpen(false);
  }, [open]);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  // The student's header shows the coaches (any admin); an admin's shows the picked student.
  const status = useOtherStatus(user?.id ?? null, isAdmin ? (picked?.id ?? null) : null);
  const [coach, setCoach] = useState("coach");
  const keyboard = useKeyboardArea(open);
  const pathname = usePathname();

  // A tapped message notification lands on ?chat=1: open the chat, then drop the flag from the address.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("chat")) return;
    setOpen(true);
    params.delete("chat");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  }, [pathname]);

  useEffect(() => {
    if (open && isAdmin === false) coachName().then(setCoach).catch(() => {});
  }, [open, isAdmin]);
  // On a student's admin page, the dock opens straight into their thread.
  useEffect(() => {
    if (openStudentId) setPicked({ id: openStudentId, name: openStudentName });
  }, [openStudentId, openStudentName]);

  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  if (!supabase || !user || isAdmin === null) return null;
  const studentId = isAdmin ? (picked?.id ?? null) : user.id;
  const title = isAdmin ? (picked ? picked.name || "student" : "inbox") : coach;
  const statusText = !studentId ? null : otherTyping ? "typing…" : status.online ? "online" : status.lastSeen ? lastSeenLabel(status.lastSeen) : null;

  return (
    <>
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 22, delay: 0.5 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => {
          buzz();
          setOpen(true);
        }}
        aria-label={unread ? `chat, ${unread} unread` : "chat"}
        className={`fixed right-4 z-40 grid size-12 place-items-center rounded-full border border-line-2 bg-ink-2/90 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.5)] backdrop-blur-xl lg:right-6 lg:bottom-6 ${
          placement === "app" ? "bottom-[calc(max(env(safe-area-inset-bottom),14px)+124px)]" : "bottom-6"
        }`}
      >
        <MessageCircle className="size-5" strokeWidth={2.2} />
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-red px-1 font-mono text-[11px] text-ink"
            >
              {unread > 9 ? "9+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px] lg:bg-black/20" />
            <motion.aside
              role="dialog"
              aria-label="chat"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.4 }}
              dragListener={false}
              dragControls={drag}
              onDragEnd={(_, info) => info.offset.y > 120 && close()}
              style={keyboard ? { top: keyboard.top, height: keyboard.height, bottom: "auto" } : undefined}
              className="fixed inset-x-0 bottom-0 z-[61] flex h-[88dvh] flex-col overflow-hidden rounded-t-[22px] border-t border-line-2 bg-ink lg:inset-auto lg:top-6 lg:right-6 lg:bottom-6 lg:h-auto lg:w-[420px] lg:rounded-[22px] lg:border"
            >
              {/* Swipe down on the handle or header to close (phones). Hidden while typing: every pixel counts then. */}
              {!keyboard && (
                <div onPointerDown={(e) => drag.start(e)} className="flex shrink-0 cursor-grab touch-none justify-center pt-2.5 lg:hidden">
                  <span className="h-1 w-10 rounded-full bg-line-2" />
                </div>
              )}
              <header onPointerDown={(e) => drag.start(e)} className={`flex shrink-0 touch-none items-center gap-3 border-b border-line px-4 lg:touch-auto ${keyboard ? "py-2.5" : "py-3.5"}`}>
                {isAdmin && picked && !openStudentId && (
                  <button onClick={() => setPicked(null)} aria-label="back to inbox" className="-ml-1 text-mute hover:text-fg">
                    <ArrowLeft className="size-5" />
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[17px] font-semibold tracking-tight">{title}</div>
                  <Label className="flex items-center gap-1.5">
                    {status.online && studentId && !otherTyping && <span className="size-1.5 rounded-full bg-red" />}
                    {statusText ?? (isAdmin ? (picked ? "student" : "messages") : "your coach")}
                  </Label>
                </div>
                {/* Student and coach can talk face to face too: the call keeps going after the chat closes. */}
                {studentId && <CallButton variant="icon" context={`coach:${studentId}`} invitees={isAdmin ? [{ id: studentId, name: title }] : []} label={`video call ${title}`} />}
                <button onClick={close} aria-label="close chat" className="grid size-8 place-items-center rounded-full text-mute hover:bg-ink-2 hover:text-fg">
                  <X className="size-5" />
                </button>
              </header>
              {!keyboard && <NotifyPrompt />}
              {studentId ? (
                <Thread
                  key={studentId}
                  studentId={studentId}
                  meId={user.id}
                  isAdmin={!!isAdmin}
                  otherName={isAdmin ? picked?.name || "student" : coach}
                  keyboard={!!keyboard}
                  onTyping={setOtherTyping}
                />
              ) : (
                <Inbox refreshKey={unread} onPick={(t) => setPicked({ id: t.studentId, name: t.name })} />
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
