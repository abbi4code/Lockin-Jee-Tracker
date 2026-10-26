"use client";

import { motion } from "motion/react";
import { ArrowRight, Download, LogOut, SkipForward, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CallButton } from "../components/call/CallButton";
import { Board, type Drawing } from "../components/skribbl/Board";
import { Chat } from "../components/skribbl/Chat";
import { InviteLink, Lobby } from "../components/skribbl/Lobby";
import { Avatar, burst, Countdown, PlayerList, SketchGlyph, useSecondsLeft, WordLine } from "../components/skribbl/parts";
import { buzz } from "../components/Controls";
import { Page } from "../components/Shell";
import { DotText, fadeUp, Label, Section } from "../components/ui";
import { createRoom, myRooms, useSkribbl, type Skribbl } from "../lib/skribbl/room";
import { activePlayers, CODE, type Room } from "../lib/skribbl/rules";
import { play, setSoundOn, soundOn } from "../lib/skribbl/sound";
import { useProgress } from "../store/progress";

/** Laptop-wide screen (the game's three columns). */
function useWide() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return wide;
}

/** How long the drawer can be off the room's connection before their turn is skipped. */
const AWAY_MS = 8000;

const STATUS: Record<Room["status"], string> = { lobby: "in the lobby", choosing: "playing", drawing: "playing", reveal: "playing", over: "finished" };

function Header({ code, children }: { code?: string; children?: ReactNode }) {
  return (
    <motion.header variants={fadeUp} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 pb-6">
      <div className="flex items-baseline gap-3">
        <Link href="/extras" className="font-mono text-[12px] text-mute transition hover:text-fg">
          extras /
        </Link>
        {code ? (
          <Link href="/extras/skribbl" className="dot text-lg transition hover:text-mute">
            skribbl
          </Link>
        ) : (
          <span className="dot text-lg">skribbl</span>
        )}
        {code && <span className="font-mono text-[13px] tracking-[0.2em] text-mute">{code}</span>}
      </div>
      {children}
    </motion.header>
  );
}

const HOW = [
  "Make a room and send the link. Everyone needs to be signed in.",
  "Each round, everyone draws once. The drawer picks a word; the rest type guesses in the chat.",
  "Guess faster, score more. The drawer scores when people get it.",
  "Blanks show the word's length, and letters appear as hints while time runs out.",
];

/** /extras/skribbl: open a room, join one by code, or go back to one you're in. */
export function SkribblHome() {
  const name = useProgress((st) => st.settings.name) || "player";
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [rooms, setRooms] = useState<Awaited<ReturnType<typeof myRooms>>>([]);
  useEffect(() => {
    myRooms().then(setRooms);
  }, []);

  const open = async () => {
    setBusy(true);
    setMsg("opening a room…");
    try {
      const c = await createRoom(name);
      buzz(10);
      router.push(`/extras/skribbl/${c}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "couldn't open a room. try again.");
      setBusy(false);
    }
  };
  // Accepts the code or a pasted link.
  const typed = (code.trim().toUpperCase().match(/[A-Z0-9]{6}$/)?.[0] ?? "").replace(/[^A-Z0-9]/g, "");
  const valid = CODE.test(typed);

  return (
    <Page>
      <Header />
      <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
        <motion.section variants={fadeUp} className="border-t border-line pt-8 pb-10 lg:col-span-7">
          <SketchGlyph className="size-14" />
          <h1 className="mt-5 text-[34px] leading-[1.05] font-semibold tracking-tight lg:text-[46px]">
            One draws.
            <br />
            <span className="text-mute">Everyone guesses.</span>
          </h1>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button onClick={open} disabled={busy} data-cursor="go" className="flex items-center gap-2 rounded-full bg-fg px-6 py-3 text-[15px] font-medium text-ink disabled:opacity-50">
              new room <ArrowRight className="size-4" />
            </button>
            {msg && <span className="font-mono text-[12px] text-mute">{msg}</span>}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) router.push(`/extras/skribbl/${typed}`);
            }}
            className="mt-8 flex max-w-sm items-center gap-2"
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="room code or link"
              aria-label="room code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 border-b border-line-2 bg-transparent py-2 font-mono text-[16px] tracking-[0.12em] uppercase outline-none placeholder:tracking-normal placeholder:text-dim placeholder:normal-case focus:border-mute"
            />
            <button type="submit" disabled={!valid} className="rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg disabled:opacity-40">
              join
            </button>
          </form>
        </motion.section>

        <div className="lg:col-span-5">
          {rooms.length > 0 && (
            <Section label="your rooms">
              {rooms.map((r) => (
                <Link key={r.code} href={`/extras/skribbl/${r.code}`} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-ink-2">
                  <span className={`size-1.5 rounded-full ${r.status === "lobby" ? "bg-dot-off" : "bg-red"}`} />
                  <span className="flex-1 font-mono text-[14px] tracking-[0.16em]">{r.code}</span>
                  <span className="font-mono text-[12px] text-dim">{STATUS[r.status]}</span>
                  <ArrowRight className="size-3.5 text-dim transition group-hover:text-fg" />
                </Link>
              ))}
            </Section>
          )}
          <Section label="how it works">
            <ol>
              {HOW.map((line, i) => (
                <li key={i} className="grid grid-cols-[2.5rem_1fr] gap-2 border-b border-line/60 py-3">
                  <DotText className="pt-0.5 text-[17px] leading-none text-dim">{String(i + 1).padStart(2, "0")}</DotText>
                  <p className="text-[15px] leading-snug text-mute">{line}</p>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>
    </Page>
  );
}

/** /extras/skribbl/<code>: the lobby, then the game. */
export function SkribblRoom({ code }: { code: string }) {
  const name = useProgress((st) => st.settings.name) || "player";
  return <RoomView s={useSkribbl(code, name)} code={code} />;
}

/** The room on screen, from the live room in `s`. */
export function RoomView({ s, code }: { s: Skribbl; code: string }) {
  const router = useRouter();
  const wide = useWide();
  const room = s.room;
  const [sound, setSound] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState(false);
  useEffect(() => setSound(soundOn()), []);

  // Sounds: your turn to pick, the turn's end, guesses, the last seconds.
  const prev = useRef<{ status?: string; drawer?: string | null }>({});
  useEffect(() => {
    if (!room) return;
    const p = prev.current;
    if (room.status === "choosing" && room.drawer === s.me && (p.status !== "choosing" || p.drawer !== room.drawer)) {
      play("turn");
      buzz(25);
    }
    if (room.status === "reveal" && p.status === "drawing") play("end");
    prev.current = { status: room.status, drawer: room.drawer };
  }, [room?.status, room?.drawer, s.me]);
  const lastHeard = useRef<number | null>(null);
  useEffect(() => {
    const last = s.messages.at(-1)?.id ?? 0;
    if (lastHeard.current != null)
      for (const m of s.messages) {
        if (m.id <= lastHeard.current || m.kind !== "correct") continue;
        play(m.user_id === s.me ? "mine" : "guessed");
        burst(s.players.find((p) => p.user_id === m.user_id)?.hue ?? 0, m.user_id === s.me);
      }
    lastHeard.current = Math.max(lastHeard.current ?? 0, last);
  }, [s.messages, s.me]);

  // Every drawing of this game, for the gallery at the end (kept by this app, from when it joined).
  const [gallery, setGallery] = useState<Drawing[]>([]);
  const keep = useCallback((d: Drawing) => setGallery((g) => (g.some((x) => x.key === d.key) ? g : [...g, d])), []);
  useEffect(() => {
    if (room?.status === "lobby") setGallery([]);
  }, [room?.status]);

  // A drawer who's gone (app closed, phone locked) would leave everyone waiting out the clock. Once they've been off
  // the room's connection for AWAY_MS, one app skips their turn: the host's, or if the host is the one away, the
  // first other player's who's here.
  const turn = !!room && (room.status === "choosing" || room.status === "drawing");
  const away = turn && s.connected && s.online.size > 0 && !!room?.drawer && !s.online.has(room.drawer);
  const skipper = !room ? null : s.online.has(room.host) && room.host !== room.drawer ? room.host : activePlayers(s.players).find((p) => p.user_id !== room.drawer && s.online.has(p.user_id))?.user_id;
  useEffect(() => {
    if (!away || skipper !== s.me) return;
    const t = window.setTimeout(() => s.act({ type: "skip" }), AWAY_MS);
    return () => window.clearTimeout(t);
  }, [away, skipper, s.me, room?.drawer, room?.status, s.act]);
  const deadline = room && (room.status === "drawing" || room.status === "choosing") ? Date.parse(room.phase_ends_at ?? "") : null;
  const left = useSecondsLeft(deadline, s.now);
  useEffect(() => {
    if (room?.status === "drawing" && left != null && left > 0 && left <= 5) play("tick");
  }, [left, room?.status]);

  const leave = async () => {
    if (room && room.status !== "lobby" && room.status !== "over" && !confirmLeave) return setConfirmLeave(true);
    await s.act({ type: "leave" });
    router.push("/extras/skribbl");
  };

  const tools = (
    <div className="flex items-center gap-2">
      {s.notice && <span className="font-mono text-[12px] text-red">{s.notice}</span>}
      {room && !s.connected && <span className="font-mono text-[12px] text-dim">reconnecting…</span>}
      {/* A video call with everyone in the room; it stays open after you leave the page. */}
      {room && activePlayers(s.players).some((p) => p.user_id !== s.me) && (
        <CallButton variant="icon" bordered context={`skribbl:${room.id}`} invitees={activePlayers(s.players).filter((p) => p.user_id !== s.me).map((p) => ({ id: p.user_id, name: p.name }))} label="video call the room" />
      )}
      <button
        onClick={() => {
          setSoundOn(!sound);
          setSound(!sound);
        }}
        aria-label={sound ? "mute sounds" : "turn sounds on"}
        className="grid size-9 place-items-center rounded-full border border-line-2 text-mute transition hover:border-fg hover:text-fg"
      >
        {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
      </button>
      {room && (
        <button
          onClick={leave}
          onBlur={() => setConfirmLeave(false)}
          data-cursor="danger"
          className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] transition ${confirmLeave ? "border-red text-red" : "border-line-2 text-mute hover:border-red hover:text-red"}`}
        >
          <LogOut className="size-3.5" /> {confirmLeave ? "tap again to leave" : "leave"}
        </button>
      )}
    </div>
  );

  if (s.fatal || !room)
    return (
      <Page>
        <Header code={code}>{tools}</Header>
        <motion.div variants={fadeUp} className="border-t border-line pt-8">
          {s.fatal ? (
            <>
              <p className="text-[17px]">{s.fatal}</p>
              <Link href="/extras/skribbl" className="mt-4 inline-flex items-center gap-1.5 font-mono text-[13px] text-mute transition hover:text-fg">
                back to skribbl <ArrowRight className="size-3.5" />
              </Link>
            </>
          ) : (
            <p className="font-mono text-[13px] text-mute">joining room {code}…</p>
          )}
        </motion.div>
      </Page>
    );

  const players = activePlayers(s.players);
  const drawerName = s.players.find((p) => p.user_id === room.drawer)?.name ?? "someone";
  const say = (text: string) => s.act({ type: "say", text });
  const guessers = players.filter((p) => p.user_id !== room.drawer);
  const got = guessers.filter((p) => p.guessed_at).length;
  const canSkip = turn && room.drawer !== s.me && (room.host === s.me || away);
  const kick = (user: string) => s.act({ type: "kick", user });

  if (room.status === "lobby")
    return (
      <Page>
        <Header code={code}>{tools}</Header>
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
          <div className="lg:col-span-7">
            <Section label="invite" right="friends need to be signed in">
              <InviteLink code={code} />
            </Section>
            <Lobby s={s} />
          </div>
          <div className="lg:col-span-5">
            <Section label="players" right={`${players.length} / ${room.settings.maxPlayers}`}>
              <PlayerList room={room} players={s.players} me={s.me} online={s.online} onKick={kick} />
            </Section>
            <Section label="chat">
              <Chat room={room} players={s.players} messages={s.messages} me={s.me} onSay={say} className="h-72" />
            </Section>
          </div>
        </div>
      </Page>
    );

  return (
    <Page>
      <Header code={code}>{tools}</Header>
      {/* Round · the word · the clock. */}
      <motion.div variants={fadeUp} className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-line pt-4">
        <div>
          <Label className="whitespace-nowrap">{room.status === "over" ? "final" : `round ${room.round}/${room.settings.rounds}`}</Label>
          <div className="mt-1 hidden font-mono text-[12px] text-dim sm:block">{away ? `${drawerName} is away` : room.status === "drawing" ? `${drawerName} is drawing` : ""}</div>
          {canSkip && (
            <button onClick={() => s.act({ type: "skip" })} className="mt-1.5 flex items-center gap-1 font-mono text-[11.5px] text-mute transition hover:text-fg">
              <SkipForward className="size-3" /> skip turn
            </button>
          )}
        </div>
        <WordLine room={room} me={s.me} word={s.secret.word} drawerName={drawerName} got={room.status === "reveal" ? (got === guessers.length && got ? "everyone got it!" : `${got} of ${guessers.length} got it`) : undefined} />
        <div className="text-right">
          <Countdown seconds={room.status === "drawing" || room.status === "choosing" ? left : null} />
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
        <aside className="order-3 lg:order-none lg:col-span-3">
          <Label className="mb-1">players</Label>
          <PlayerList room={room} players={s.players} me={s.me} online={s.online} onKick={kick} />
        </aside>
        <div className="order-1 lg:order-none lg:col-span-6">
          <Board s={s} onDrawing={keep} />
        </div>
        {/* Laptops: the chat is as tall as the board. Phones: the guess box right under the board, newest lines below. */}
        <div className="relative order-2 h-64 lg:order-none lg:col-span-3 lg:h-auto">
          <div className="flex h-full flex-col lg:absolute lg:inset-0">
            <Label className="mb-1 hidden lg:block">chat</Label>
            <Chat room={room} players={s.players} messages={s.messages} me={s.me} onSay={say} newestFirst={!wide} className="flex-1" />
          </div>
        </div>
      </motion.div>

      {room.status === "over" && gallery.length > 0 && (
        <Section label="drawings from this game" right={`${gallery.length} drawing${gallery.length === 1 ? "" : "s"}`} className="mt-8">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
            {gallery.map((d, i) => (
              <motion.figure key={d.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.06 } }} className="group">
                <div className="relative overflow-hidden rounded-md border border-line-2">
                  {/* A data URL made in this browser: next/image has nothing to optimise. */}
                  <img src={d.url} alt={`${d.drawer}'s drawing of ${d.word}`} className="block aspect-[4/3] w-full" />
                  <a
                    href={d.url}
                    download={`skribbl-${d.word.replace(/\s+/g, "-")}.jpg`}
                    aria-label={`download ${d.word}`}
                    className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-ink/80 text-fg opacity-100 transition lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
                  >
                    <Download className="size-3.5" />
                  </a>
                </div>
                <figcaption className="mt-2 flex items-center gap-2">
                  <Avatar hue={d.hue} size={8} />
                  <span className="min-w-0 truncate text-[14.5px] font-medium">{d.word}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11.5px] text-dim">{d.drawer}</span>
                </figcaption>
              </motion.figure>
            ))}
          </div>
        </Section>
      )}
    </Page>
  );
}
