/** Public STUN servers: enough for most home and mobile networks. A TURN relay (TURN_URLS, /api/call/ice) covers the rest. */
export const STUN: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
