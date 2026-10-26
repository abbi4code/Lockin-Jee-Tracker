import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallRow, Invitee, MemberRow } from "./calls";
import type { CallBackend } from "./session";
import { channelSignal } from "./signal";
import { STUN } from "./stun";

// CallBackend on Supabase: the security definer functions of 20261026180000_calls.sql for every write, plain
// selects (row-level security: members only) for reads, Realtime for the roster and the signaling channel.

/** The ICE servers from /api/call/ice (a TURN relay when configured); public STUN if that's slow or fails. */
async function iceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch("/api/call/ice", { signal: AbortSignal.timeout(3000) });
    const body = (await res.json()) as { iceServers?: RTCIceServer[] };
    return res.ok && body.iceServers?.length ? body.iceServers : STUN;
  } catch {
    return STUN;
  }
}

/** Errors from the database functions carry a message meant for the user ("you can't call yourself."). */
function check<T>(r: { data: T; error: { message: string } | null }) {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

/** `token`: the signed-in user's current access token (for the keepalive request when the page closes). */
export function supabaseBackend(sb: SupabaseClient, token: () => string | null): CallBackend {
  return {
    async start(context: string, invitees: Invitee[], myName: string) {
      return check(await sb.rpc("start_call", { p_context: context, p_invitees: invitees.map((i) => i.id), p_names: invitees.map((i) => i.name), p_name: myName })) as string;
    },
    async setState(call, state, name) {
      check(await sb.rpc("set_call_state", { p_call: call, p_state: state, p_name: name ?? null }));
    },
    async heartbeat(call) {
      check(await sb.rpc("call_heartbeat", { p_call: call }));
    },
    async load(call) {
      const [c, m] = await Promise.all([sb.from("calls").select("*").eq("id", call).single(), sb.from("call_members").select("*").eq("call", call)]);
      return { call: check(c) as CallRow, members: check(m) as MemberRow[] };
    },
    watch(call, onChange) {
      const ch = sb
        .channel(`call-roster:${call}:${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "call_members", filter: `call=eq.${call}` }, onChange)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls", filter: `id=eq.${call}` }, onChange)
        // A dropped connection can miss changes: catch up whenever it (re)connects.
        .subscribe((status) => status === "SUBSCRIBED" && onChange());
      return () => void sb.removeChannel(ch);
    },
    signal(call) {
      const ch = sb.channel(`call:${call.id}:${call.key}`, { config: { broadcast: { self: false } } });
      return { ...channelSignal(ch), close: () => void sb.removeChannel(ch) };
    },
    iceServers,
    beacon(call) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      const t = token();
      if (!url || !key || !t) return;
      // supabase-js can't send a keepalive request, which is the only kind that outlives the page.
      void fetch(`${url}/rest/v1/rpc/set_call_state`, {
        method: "POST",
        keepalive: true,
        headers: { apikey: key, authorization: `Bearer ${t}`, "content-type": "application/json" },
        body: JSON.stringify({ p_call: call, p_state: "left" }),
      }).catch(() => {});
    },
    async mine(me) {
      const since = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data } = await sb.from("call_members").select("*").eq("user_id", me).gte("updated_at", since);
      return (data ?? []) as MemberRow[];
    },
    watchMine(me, onChange) {
      const ch = sb
        .channel(`call-inbox:${me}:${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "call_members", filter: `user_id=eq.${me}` }, onChange)
        .subscribe((status) => status === "SUBSCRIBED" && onChange());
      return () => void sb.removeChannel(ch);
    },
    notify(call) {
      void fetch("/api/call/notify", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ call }) }).catch(() => {});
    },
  };
}
