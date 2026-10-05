// Runs the engine off the main thread so the board stays responsive while the computer thinks.
import { bestMove, type Level } from "./engine";

self.onmessage = (e: MessageEvent<{ id: number; fen: string; level: Level }>) => {
  const { id, fen, level } = e.data;
  self.postMessage({ id, move: bestMove(fen, level) });
};
