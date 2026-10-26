import type { RealtimeChannel } from "@supabase/supabase-js";
import type { MeshSignal, MeshWire } from "./mesh";

const isWire = (x: unknown): x is MeshWire => !!x && typeof (x as MeshWire).from === "string" && typeof (x as MeshWire).user === "string" && typeof (x as MeshWire).kind === "string";

type Channel = Pick<RealtimeChannel, "on" | "subscribe" | "send" | "state">;

/**
 * A call's signaling over a Realtime broadcast channel. Subscribes it; messages sent before the channel is joined
 * wait and go out in order once it is. Anything that isn't a call message is ignored. When the channel comes back
 * after dropping, `onReconnect` listeners hear of it (messages sent meanwhile may be lost).
 */
export function channelSignal(channel: Channel): MeshSignal {
  const listeners = new Set<(m: MeshWire) => void>();
  const reconnects = new Set<() => void>();
  const pending: MeshWire[] = [];
  // A channel can already be joined (the client hands back an existing channel for the same topic).
  let ready = channel.state === "joined";
  let joinedOnce = ready;
  const push = (m: MeshWire) => void channel.send({ type: "broadcast", event: "call", payload: m });
  channel
    .on("broadcast", { event: "call" }, ({ payload }) => {
      if (isWire(payload)) for (const l of listeners) l(payload);
    })
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") ready = false;
        return;
      }
      ready = true;
      for (const m of pending.splice(0)) push(m);
      if (joinedOnce) for (const r of reconnects) r();
      joinedOnce = true;
    });
  return {
    send: (m) => (ready ? push(m) : void pending.push(m)),
    listen: (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    onReconnect: (cb) => {
      reconnects.add(cb);
      return () => void reconnects.delete(cb);
    },
  };
}
