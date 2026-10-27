import "server-only";
import { AccessToken } from "livekit-server-sdk";

// LiveKit on the server: signs the tokens browsers join a call's room with. Keys: LIVEKIT_URL (wss://…, sent to the
// browser), LIVEKIT_API_KEY and LIVEKIT_API_SECRET (server only). See .env.example.

export function livekitConfigured() {
  return !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

export const livekitUrl = () => process.env.LIVEKIT_URL!;

/** The LiveKit room for call `id`. Named by the server only, so a token can never name someone else's room. */
export const roomFor = (id: string) => `call-${id}`;

/**
 * A token to join `room` as `identity` (the user id: a second device with the same identity takes over). It's only
 * good for that room, can't create or administer rooms, and only needs to be valid when connecting (LiveKit refreshes
 * it during the call; a rejoin asks the route for a fresh one).
 */
export function mintToken(opts: { room: string; identity: string; name: string }) {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, { identity: opts.identity, name: opts.name, ttl: "1h" });
  at.addGrant({ roomJoin: true, room: opts.room, canPublish: true, canSubscribe: true, canPublishData: true });
  return at.toJwt();
}
