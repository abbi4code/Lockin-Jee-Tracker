// How a call's media actually travels, behind one small interface, so the call's lifecycle (session.ts) doesn't
// depend on it. In the app it's LiveKit (livekit.ts): every device connects to a media server with a public address,
// which works through the carrier-grade NAT of mobile data where device-to-device connections fail. The tests use a
// fake.

export type PeerStatus = "connecting" | "live" | "reconnecting";

/** Someone else in the call, as this device sees them. */
export interface Peer {
  sid: string;
  user: string;
  name: string;
  /** Their camera and mic, once they arrive. */
  stream: MediaStream | null;
  mic: boolean;
  cam: boolean;
  status: PeerStatus;
}

export interface TransportEvents {
  onChange(peers: Peer[]): void;
  /** Your other tab or device joined this call, so this one was let go. */
  onMoved(): void;
  /** The connection is gone for good (retries used up). */
  onFailed(): void;
}

export interface CallTransport {
  /** Connects and sends your camera and mic. Rejects with a message meant for the user. */
  connect(): Promise<void>;
  /** Switches your mic or camera on or off for everyone. */
  setMedia(mic: boolean, cam: boolean): void;
  /** Leaves. (Whether it was a hang-up or a closing page is the roster's business: see session.ts.) */
  leave(): void;
  readonly peers: Peer[];
}
