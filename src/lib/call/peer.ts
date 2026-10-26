// One WebRTC connection to one other person in a call. A call with N people is N-1 of these per device (a mesh,
// see mesh.ts). Media goes straight between the two devices, encrypted end to end (DTLS-SRTP).
//
// Negotiation is "perfect negotiation", with one rule added: only the impolite side opens with an offer, and the
// polite side adds its media when it answers. If both opened with offers, the polite side would roll its own back,
// and Chromium then sometimes never gathers network candidates for the answer: the call sits on "connecting".

export type LinkMessage = { kind: "sdp"; description: RTCSessionDescriptionInit } | { kind: "ice"; candidate: RTCIceCandidateInit };
export type LinkStatus = "connecting" | "live" | "reconnecting";

export interface LinkOptions {
  /** Gives way when both sides send an offer at once. Exactly one side of a pair is polite. */
  polite: boolean;
  local: MediaStream | null;
  iceServers: RTCIceServer[];
  send: (m: LinkMessage) => void;
  /** Video bandwidth for this link, applied once it connects (encodings only exist after negotiation). */
  budget?: () => { maxBitrate: number; scaleDown: number };
  onChange: () => void;
}

export class PeerLink {
  stream: MediaStream | null = null;
  status: LinkStatus = "connecting";
  /**
   * Since when the connection hasn't been working (to give up on a peer that's gone), or null while it is. Starts
   * at creation, so a handshake that never completes (a lost message) times out too.
   */
  downSince: number | null = Date.now();
  private pc: RTCPeerConnection;
  private makingOffer = false;
  private ignoreOffer = false;
  /** Messages are handled one at a time, in order: an answer must not overtake the offer before it. */
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private tuning: Promise<void> = Promise.resolve();

  constructor(private o: LinkOptions) {
    const pc = new RTCPeerConnection({ iceServers: o.iceServers });
    this.pc = pc;
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        if (!this.closed) o.send({ kind: "sdp", description: pc.localDescription!.toJSON() });
      } catch {
        // A newer description replaced this one; that negotiation carries on instead.
      } finally {
        this.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && !this.closed) o.send({ kind: "ice", candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? this.stream ?? new MediaStream();
      if (!stream.getTracks().includes(track)) stream.addTrack(track);
      this.stream = stream;
      o.onChange();
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
        this.status = "live";
        this.downSince = null;
        const b = o.budget?.();
        if (b) void this.tune(b.maxBitrate, b.scaleDown);
      } else if (s === "disconnected" || s === "failed") {
        this.status = "reconnecting";
        this.downSince ??= Date.now();
        // Try new network paths (the impolite side's offer carries the restart).
        if (s === "failed" && !o.polite) pc.restartIce();
      }
      o.onChange();
    };
    if (!o.polite) this.addTracks();
  }

  /** An SDP or ICE message from the other side. */
  handle(m: LinkMessage) {
    this.queue = this.queue.then(() => this.apply(m)).catch(() => {
      // A broken message spoils only itself; ICE restarts and the drop timer deal with a dead connection.
    });
    return this.queue;
  }

  /**
   * Bandwidth per outgoing video: the more people in the call, the less each copy gets (each is encoded apart).
   * Runs one at a time: overlapping setParameters calls fail (each must use the latest getParameters).
   */
  tune(maxBitrate: number, scaleDown: number) {
    this.tuning = this.tuning.then(async () => {
      if (this.closed) return;
      for (const sender of this.pc.getSenders()) {
        if (sender.track?.kind !== "video") continue;
        const p = sender.getParameters();
        if (!p.encodings?.length) continue;
        p.encodings[0].maxBitrate = maxBitrate;
        p.encodings[0].scaleResolutionDownBy = scaleDown;
        await sender.setParameters(p).catch(() => {});
      }
    });
    return this.tuning;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const pc = this.pc;
    pc.onnegotiationneeded = pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = null;
    pc.close();
  }

  private async apply(m: LinkMessage) {
    if (this.closed) return;
    const pc = this.pc;
    if (m.kind === "ice") {
      try {
        await pc.addIceCandidate(m.candidate);
      } catch (e) {
        // Candidates for an offer we ignored are expected to fail.
        if (!this.ignoreOffer) throw e;
      }
      return;
    }
    const d = m.description;
    const collision = d.type === "offer" && (this.makingOffer || pc.signalingState !== "stable");
    this.ignoreOffer = !this.o.polite && collision;
    if (this.ignoreOffer) return;
    await pc.setRemoteDescription(d);
    if (d.type === "offer") {
      // The polite side's media goes out with its first answer (see the top of the file).
      this.addTracks();
      await pc.setLocalDescription();
      if (!this.closed) this.o.send({ kind: "sdp", description: pc.localDescription!.toJSON() });
    }
  }

  private addTracks() {
    const local = this.o.local;
    if (!local || this.pc.getSenders().some((s) => s.track)) return;
    for (const t of local.getTracks()) this.pc.addTrack(t, local);
  }
}
