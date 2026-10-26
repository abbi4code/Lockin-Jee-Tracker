// Runs the engine off the main thread so the board stays responsive while the computer thinks.
import { bestMove, type Level } from "./engine";

// `history` is the FEN of every earlier position in the game, oldest first, so the engine can see repetitions.
self.onmessage = (e: MessageEvent<{ id: number; fen: string; level: Level; history?: string[] }>) => {
  const { id, fen, level, history = [] } = e.data;
  self.postMessage({ id, move: bestMove(fen, level, history) });
};
