"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TEXT_MAX, type Message, type Player, type Room } from "../../lib/skribbl/rules";
import { hueColor } from "./parts";

/**
 * Guesses and chat in one place, like skribbl: a right guess shows as "… guessed the word!", never the word; "close!"
 * goes only to the one who typed it; once you've guessed (or while you draw) you talk only to the others who know.
 * `newestFirst` (phones, in a game): the box on top, right under the board, with the latest lines just below it.
 */
export function Chat({ room, players, messages, me, onSay, newestFirst = false, className = "" }: { room: Room; players: Player[]; messages: Message[]; me: string | null; onSay: (text: string) => void; newestFirst?: boolean; className?: string }) {
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const hue = new Map(players.map((p) => [p.user_id, p.hue]));
  const self = players.find((p) => p.user_id === me);
  const insider = room.status === "drawing" && (room.drawer === me || !!self?.guessed_at);
  const guessing = room.status === "drawing" && !insider;

  // Follow new lines, unless they've scrolled up to read.
  useEffect(() => {
    const el = list.current;
    if (el && stick.current && !newestFirst) el.scrollTop = el.scrollHeight;
  }, [messages.length, newestFirst]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSay(t);
    setText("");
  };

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto py-2"
        aria-live="polite"
      >
        {messages.length === 0 && <p className="font-mono text-[12px] text-dim">no messages yet. say hi.</p>}
        {(newestFirst ? [...messages].reverse() : messages).map((m) => {
          if (m.kind === "system") return <p key={m.id} className="font-mono text-[12px] leading-snug text-dim">{m.body}</p>;
          if (m.kind === "close") return <p key={m.id} className="font-mono text-[12.5px] text-red">{m.body}</p>;
          if (m.kind === "correct")
            return (
              <p key={m.id} className="flex items-center gap-2 text-[14.5px] font-medium text-red">
                <span className="size-1.5 shrink-0 rounded-full bg-red" />
                {m.user_id === me ? "you guessed the word!" : m.body}
              </p>
            );
          return (
            <p key={m.id} className={`text-[14.5px] leading-snug break-words ${m.audience === "guessed" ? "border-l-2 border-red/50 pl-2 text-mute" : ""}`}>
              <span className="font-medium" style={{ color: m.user_id ? hueColor(hue.get(m.user_id) ?? 0) : undefined }}>
                {m.user_id === me ? "you" : m.name}
              </span>{" "}
              <span className={m.audience === "guessed" ? "" : "text-fg"}>{m.body}</span>
            </p>
          );
        })}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className={`flex items-center gap-2 border-line ${newestFirst ? "order-first border-b pb-2" : "border-t pt-2"}`}
      >
        {/* 16px: iPhones zoom into smaller inputs. */}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={TEXT_MAX}
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={guessing ? "type your guess…" : insider ? "chat with the ones who know…" : "say something…"}
          aria-label={guessing ? "your guess" : "message"}
          className="min-w-0 flex-1 bg-transparent py-2 text-[16px] outline-none placeholder:text-dim"
        />
        <button type="submit" disabled={!text.trim()} aria-label="send" className="grid size-9 shrink-0 place-items-center rounded-full bg-fg text-ink transition disabled:opacity-30">
          <ArrowUp className="size-4" strokeWidth={2.5} />
        </button>
      </form>
    </div>
  );
}
