"use client";

import { Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { activePlayers, CUSTOM_MIN, DRAW_TIMES, LIMITS, type Settings } from "../../lib/skribbl/rules";
import type { Skribbl } from "../../lib/skribbl/room";
import { Check, Segmented, Stepper } from "../Controls";
import { Section } from "../ui";
import { range } from "./parts";

/** Copies the room link (or opens the share sheet on phones). */
export function InviteLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/extras/skribbl/${code}` : "";
  const copy = async () => {
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) await navigator.share({ title: "skribbl on lockin.", url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      // Share sheet dismissed.
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="room link" className="min-w-0 flex-1 border-b border-line-2 bg-transparent py-2 font-mono text-[12.5px] text-mute outline-none" />
      <button onClick={copy} className="flex shrink-0 items-center gap-1.5 rounded-full border border-line-2 px-3.5 py-1.5 text-[13px] text-mute transition hover:border-fg hover:text-fg">
        <Copy className="size-3.5" /> {copied ? "copied" : "copy link"}
      </button>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line/70 py-3">
      <div>
        <div className="text-[15px]">{label}</div>
        {hint && <div className="font-mono text-[11.5px] text-dim">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

const WORD_LISTS = { general: "everyday", jee: "jee", both: "both" } as const;

/** Game settings: the host changes them, everyone sees them. Custom words are the host's alone. */
export function Lobby({ s }: { s: Skribbl }) {
  const room = s.room!;
  const host = room.host === s.me;
  const st = room.settings;
  const set = (patch: Partial<Settings>) => s.act({ type: "settings", settings: patch });
  const players = activePlayers(s.players).length;
  const hostName = s.players.find((p) => p.user_id === room.host)?.name ?? "the host";

  // The host's words load from the server (only the host gets them); edits save when the box loses focus.
  const [words, setWords] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (s.secret.custom && !loaded) {
      setWords(s.secret.custom.join(", "));
      setLoaded(true);
    }
  }, [s.secret.custom, loaded]);
  const parsed = words
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean);
  const saveWords = () => {
    if (loaded && parsed.join(",") !== (s.secret.custom ?? []).join(",")) {
      s.act({ type: "settings", settings: {}, custom: parsed });
      s.setSecret({ ...s.secret, custom: parsed });
    }
  };
  const short = st.customOnly && st.customCount < CUSTOM_MIN;

  return (
    <div>
      <Section label="game settings" right={host ? "you're the host" : `${hostName} sets these`}>
        <Row label="players" hint="most in the room">
          <Stepper label="players" values={range(...LIMITS.players)} value={st.maxPlayers} onChange={(v) => set({ maxPlayers: v })} disabled={!host} />
        </Row>
        <Row label="rounds" hint="everyone draws once a round">
          <Stepper label="rounds" values={range(...LIMITS.rounds)} value={st.rounds} onChange={(v) => set({ rounds: v })} disabled={!host} />
        </Row>
        <Row label="draw time">
          <Stepper label="seconds" values={DRAW_TIMES} value={st.drawTime} onChange={(v) => set({ drawTime: v })} format={(v) => `${v}s`} disabled={!host} />
        </Row>
        <Row label="word choices" hint="the drawer picks one">
          <Stepper label="word choices" values={range(...LIMITS.choices)} value={st.choices} onChange={(v) => set({ choices: v })} disabled={!host} />
        </Row>
        <Row label="hints" hint="letters shown while drawing">
          <Stepper label="hints" values={range(...LIMITS.hints)} value={st.hints} onChange={(v) => set({ hints: v })} disabled={!host || st.wordMode === "hidden"} />
        </Row>
        <Row label="word mode" hint={st.wordMode === "hidden" ? "no blanks, no hints" : "blanks show the length"}>
          {host ? (
            <Segmented
              id="sk-mode"
              value={st.wordMode}
              onChange={(v) => set({ wordMode: v })}
              options={[
                { value: "normal", label: "normal" },
                { value: "hidden", label: "hidden" },
              ]}
            />
          ) : (
            <span className="font-mono text-[13px]">{st.wordMode}</span>
          )}
        </Row>
        <Row label="words" hint={st.words === "jee" ? "physics, chemistry, maths" : st.words === "general" ? "everyday things" : "everyday + jee"}>
          {host ? (
            <Segmented
              id="sk-words"
              value={st.words}
              onChange={(v) => set({ words: v })}
              options={(Object.keys(WORD_LISTS) as Settings["words"][]).map((v) => ({ value: v, label: WORD_LISTS[v] }))}
            />
          ) : (
            <span className="font-mono text-[13px]">{WORD_LISTS[st.words]}</span>
          )}
        </Row>
        {host ? (
          <div className="border-b border-line/70 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-[15px]">your own words</div>
              <span className="font-mono text-[11.5px] text-dim">{parsed.length} · separate with commas</span>
            </div>
            <textarea
              value={words}
              onChange={(e) => setWords(e.target.value)}
              onBlur={saveWords}
              rows={3}
              disabled={!loaded}
              placeholder="inside jokes, teachers' names, chapter names…"
              className="mt-2 w-full resize-y rounded-md border border-line-2 bg-transparent px-3 py-2 text-[16px] leading-snug outline-none placeholder:text-dim focus:border-mute"
            />
            <div className="mt-3 flex items-center gap-2.5">
              <Check checked={st.customOnly} onToggle={() => set({ customOnly: !st.customOnly })} label="only my words" />
              <span className="text-[14.5px] text-mute">only my words</span>
              <span className="font-mono text-[11.5px] text-dim">needs {CUSTOM_MIN}+</span>
            </div>
          </div>
        ) : (
          st.customCount > 0 && (
            <Row label="own words" hint="the host's, kept secret">
              <span className="font-mono text-[13px]">
                {st.customCount}
                {st.customOnly ? " · only these" : ""}
              </span>
            </Row>
          )
        )}
      </Section>

      <div className="flex flex-wrap items-center gap-3 pb-6">
        {host ? (
          <>
            <button
              onClick={() => s.act({ type: "start" })}
              disabled={players < 2 || short}
              data-cursor="go"
              className="rounded-full bg-fg px-6 py-3 text-[15px] font-medium text-ink transition disabled:opacity-40"
            >
              start game
            </button>
            <span className="font-mono text-[12px] text-dim">{players < 2 ? "waiting for at least one more player" : short ? `add ${CUSTOM_MIN - st.customCount} more of your words` : `${players} players ready`}</span>
          </>
        ) : (
          <p className="font-mono text-[13px] text-mute">waiting for {hostName} to start…</p>
        )}
      </div>
    </div>
  );
}
