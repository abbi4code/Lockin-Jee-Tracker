import { ConnectionState, DisconnectReason, Room, RoomEvent, Track, type RemoteParticipant } from "livekit-client";
import type { CallTransport, Peer, TransportEvents } from "./transport";

// A call's media over LiveKit (an SFU). Each device sends its camera and mic once, to a media server with a public
// address, and receives everyone else's from it. A device behind carrier-grade NAT (Jio, Airtel mobile data) can't be
// reached by another device directly, but it can always reach a public server; when even UDP is blocked, LiveKit's
// own TURN over TLS on port 443 takes over. The app never deals with ICE, STUN or TURN.
//
// Who may join is decided before this: /api/call/[id]/token only signs a token for a member who's in the call, and
// the token is good for that one room. The identity is the user id, so joining from a second device lets the first go
// (DUPLICATE_IDENTITY), which is how "the call moved to your other device" works.

/** After LiveKit's own resume and reconnect attempts fail, the app rejoins with a fresh token this many times. */
const REJOIN_DELAYS = [1000, 3000, 6000];

interface Options extends TransportEvents {
  /** Fetches a fresh token for the call (and the server's address). Throws with a message meant for the user. */
  token: () => Promise<{ url: string; token: string }>;
  /** Your camera and mic, already open (the session opens them before ringing). */
  local: MediaStream;
}

export function liveKitTransport(o: Options): CallTransport {
  return new LiveKitTransport(o);
}

class LiveKitTransport implements CallTransport {
  private room: Room | null = null;
  private left = false;
  private rejoins = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  /** One stream per remote participant, kept stable so a <video> showing it doesn't restart as tracks come and go. */
  private streams = new Map<string, MediaStream>();
  private mic: boolean;
  private cam: boolean;

  constructor(private o: Options) {
    this.mic = o.local.getAudioTracks().some((t) => t.enabled);
    this.cam = o.local.getVideoTracks().some((t) => t.enabled);
  }

  async connect() {
    const { url, token } = await this.o.token();
    if (this.left) return;
    const room = new Room({
      // The app shows streams in its own <video>s, which adaptive stream can't measure: keep full quality.
      adaptiveStream: false,
      dynacast: true,
      // The session handles page close (and the camera belongs to it): LiveKit mustn't stop tracks on its own.
      disconnectOnPageLeave: false,
      stopLocalTrackOnUnpublish: false,
      publishDefaults: { simulcast: true },
    });
    this.room = room;
    const changed = () => this.changed();
    room
      .on(RoomEvent.ParticipantConnected, changed)
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        this.streams.delete(p.sid);
        changed();
      })
      .on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
        const s = this.streamOf(p);
        if (!s.getTracks().includes(track.mediaStreamTrack)) s.addTrack(track.mediaStreamTrack);
        changed();
      })
      .on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => {
        this.streamOf(p).removeTrack(track.mediaStreamTrack);
        changed();
      })
      .on(RoomEvent.TrackMuted, changed)
      .on(RoomEvent.TrackUnmuted, changed)
      .on(RoomEvent.ParticipantNameChanged, changed)
      .on(RoomEvent.ConnectionStateChanged, changed)
      .on(RoomEvent.Reconnected, () => {
        this.rejoins = 0;
        changed();
      })
      .on(RoomEvent.Disconnected, (reason) => void this.disconnected(room, reason));

    try {
      await room.connect(url, token);
    } catch (e) {
      room.removeAllListeners();
      if (this.room === room) this.room = null;
      throw new Error(e instanceof Error && /quota|limit|exceed/i.test(e.message) ? "calls are unavailable right now. try again later." : "couldn't connect the call. try again.");
    }
    if (this.left) return void room.disconnect(false);
    for (const track of this.o.local.getTracks()) {
      const pub = await room.localParticipant.publishTrack(track, { source: track.kind === "audio" ? Track.Source.Microphone : Track.Source.Camera });
      if ((track.kind === "audio" && !this.mic) || (track.kind === "video" && !this.cam)) await pub.mute();
    }
    changed();
  }

  setMedia(mic: boolean, cam: boolean) {
    this.mic = mic;
    this.cam = cam;
    const local = this.room?.localParticipant;
    for (const pub of local?.trackPublications.values() ?? []) {
      const on = pub.source === Track.Source.Microphone ? mic : pub.source === Track.Source.Camera ? cam : true;
      void (on ? pub.unmute() : pub.mute());
    }
    // Not connected yet (or between rejoins): the tracks carry the switch until they're published.
    if (!local) {
      for (const t of this.o.local.getAudioTracks()) t.enabled = mic;
      for (const t of this.o.local.getVideoTracks()) t.enabled = cam;
    }
  }

  leave() {
    if (this.left) return;
    this.left = true;
    clearTimeout(this.retry);
    const room = this.room;
    if (!room) return;
    room.removeAllListeners(RoomEvent.Disconnected);
    void room.disconnect(false);
  }

  get peers(): Peer[] {
    const room = this.room;
    if (!room) return [];
    const reconnecting = room.state === ConnectionState.Reconnecting || room.state === ConnectionState.SignalReconnecting;
    return [...room.remoteParticipants.values()].map((p) => {
      const mic = p.getTrackPublication(Track.Source.Microphone);
      const cam = p.getTrackPublication(Track.Source.Camera);
      const stream = this.streams.get(p.sid) ?? null;
      return {
        sid: p.sid,
        user: p.identity,
        name: p.name ?? "",
        stream,
        // Not published yet counts as on: "muted" should mean they switched it off.
        mic: mic ? !mic.isMuted : true,
        cam: cam ? !cam.isMuted : true,
        status: reconnecting ? "reconnecting" : stream?.getTracks().length ? "live" : "connecting",
      };
    });
  }

  private async disconnected(room: Room, reason?: DisconnectReason) {
    room.removeAllListeners();
    if (this.room === room) this.room = null;
    this.streams.clear();
    this.changed();
    if (this.left) return;
    if (reason === DisconnectReason.DUPLICATE_IDENTITY) return this.o.onMoved();
    if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.PARTICIPANT_REMOVED) return this.o.onFailed();
    this.scheduleRejoin();
  }

  /** LiveKit already tried to resume and reconnect: rejoin from scratch with a fresh token, a few times. */
  private scheduleRejoin() {
    const delay = REJOIN_DELAYS[this.rejoins++];
    if (delay == null) return this.o.onFailed();
    this.retry = setTimeout(() => void this.connect().catch(() => !this.left && this.scheduleRejoin()), delay);
  }

  private streamOf(p: RemoteParticipant) {
    let s = this.streams.get(p.sid);
    if (!s) this.streams.set(p.sid, (s = new MediaStream()));
    return s;
  }

  private changed() {
    if (!this.left) this.o.onChange(this.peers);
  }
}
