"use client";

import { AnimatePresence, motion, useDragControls } from "motion/react";
import { ArrowLeft, ArrowUp, ArrowUpRight, MessageCircle, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getChapter } from "../data";
import { useChatUser, useThread, useUnread, type Message } from "../lib/chat";
import { coachName, listThreads, type ThreadSummary } from "../lib/chat-actions";
import { supabase } from "../lib/supabase/client";
import { buzz } from "./Controls";
import { Label } from "./ui";

const QUICK_REPLIES = ["how's today going?", "logged today's test?", "proud of you 🔥", "take a 10 min break"];

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

function Bubble({ m, mine, showTime, seen, onRetry }: { m: Message; mine: boolean; showTime: boolean; seen: boolean; onRetry: () => void }) {
  const chapter = m.chapter_id ? getChapter(m.chapter_id) : null;
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: m.pending ? 0.6 : 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 36 }}
      className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
    >
      <div
        className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap ${
          mine ? "rounded-br-md bg-fg text-ink" : "rounded-bl-md border border-line-2 text-fg"
        }`}
      >
        {chapter && (
          <Link href={`/c/${chapter.id}`} className={`mb-1.5 flex items-center gap-1 font-mono text-[11px] underline-offset-2 hover:underline ${mine ? "text-ink/70" : "text-mute"}`}>
            <ArrowUpRight className="size-3" /> {chapter.name}
          </Link>
        )}
        {m.body}
      </div>
      {m.failed ? (
        <button onClick={onRetry} className="mt-1 font-mono text-[11px] text-red">
          not sent · tap to retry
        </button>
      ) : (
        (showTime || seen) && (
          <span className="mt-1 font-mono text-[10.5px] text-dim">
            {showTime && time(m.created_at)}
            {seen && (showTime ? " · seen" : "seen")}
          </span>
        )
      )}
    </motion.div>
  );
}

function Thread({ studentId, meId, isAdmin }: { studentId: string; meId: string; isAdmin: boolean }) {
  const { messages, loading, otherTyping, send, retry, markRead, typing } = useThread(studentId, meId);
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const context = pathname.startsWith("/c/") ? getChapter(pathname.slice(3)) : null;

  // Keep the newest message in view and mark what we've seen as read.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: messages.length > 1 ? "smooth" : "auto" });
    if (document.visibilityState === "visible") markRead();
  }, [messages, otherTyping, markRead]);

  const submit = (body = text) => {
    if (!body.trim()) return;
    buzz(10);
    send(body, attach && context ? context.id : null);
    setText("");
    setAttach(false);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const lastMineIndex = messages.map((m) => m.sender_id === meId).lastIndexOf(true);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="no-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-4 py-4">
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
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="my-4 flex items-center gap-3">
                    <span className="h-px flex-1 bg-line" />
                    <Label>{dayLabel(m.created_at)}</Label>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <div className={!prev || prev.sender_id !== m.sender_id ? "pt-1.5" : ""}>
                  <Bubble m={m} mine={mine} showTime={showTime} seen={i === lastMineIndex && !!m.read_at} onRetry={() => retry(m)} />
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
        <div ref={endRef} />
      </div>

      <div className="border-t border-line px-3 pt-2.5 pb-[max(env(safe-area-inset-bottom),12px)]">
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
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value.slice(0, 4000));
              typing();
            }}
            onKeyDown={onKey}
            rows={1}
            placeholder="message"
            className="max-h-32 min-h-[42px] flex-1 resize-none rounded-[21px] border border-line-2 bg-transparent px-4 py-2.5 text-[15px] leading-snug outline-none [field-sizing:content] placeholder:text-dim focus:border-mute"
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
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line-2 font-mono text-[13px] uppercase">{t.name.slice(0, 1)}</span>
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
 * Floating chat. Students get their thread with the coach; admins get an inbox of students first.
 * placement="app" sits above the nav on phones; "admin" sits in the corner (admin pages have no nav).
 */
export function ChatDock({ placement = "app", openStudentId, openStudentName = "" }: { placement?: "app" | "admin"; openStudentId?: string; openStudentName?: string }) {
  const { user, isAdmin } = useChatUser();
  const drag = useDragControls();
  const unread = useUnread(user?.id ?? null, isAdmin);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [coach, setCoach] = useState("coach");

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
              className="fixed inset-x-0 bottom-0 z-[61] flex h-[88dvh] flex-col overflow-hidden rounded-t-[22px] border-t border-line-2 bg-ink lg:inset-auto lg:top-6 lg:right-6 lg:bottom-6 lg:h-auto lg:w-[420px] lg:rounded-[22px] lg:border"
            >
              {/* Swipe down on the handle or header to close (phones). */}
              <div onPointerDown={(e) => drag.start(e)} className="flex shrink-0 cursor-grab touch-none justify-center pt-2.5 lg:hidden">
                <span className="h-1 w-10 rounded-full bg-line-2" />
              </div>
              <header onPointerDown={(e) => drag.start(e)} className="flex touch-none items-center gap-3 border-b border-line px-4 py-3.5 lg:touch-auto">
                {isAdmin && picked && !openStudentId && (
                  <button onClick={() => setPicked(null)} aria-label="back to inbox" className="-ml-1 text-mute hover:text-fg">
                    <ArrowLeft className="size-5" />
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[17px] font-semibold tracking-tight">{title}</div>
                  <Label>{isAdmin ? (picked ? "student" : "messages") : "your coach"}</Label>
                </div>
                <button onClick={close} aria-label="close chat" className="grid size-8 place-items-center rounded-full text-mute hover:bg-ink-2 hover:text-fg">
                  <X className="size-5" />
                </button>
              </header>
              {studentId ? (
                <Thread key={studentId} studentId={studentId} meId={user.id} isAdmin={!!isAdmin} />
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
