// The tanks icon on the extras page.

// Dot-matrix tank on a 7×7 grid, like the chess pieces and the skribbl pencil; the barrel's tip is red.
// prettier-ignore
const TANK = ["......X", ".....X.", "..XXX..", ".XXXXX.", "XXXXXXX", ".X.X.X.", "......."];
const TANK_DOTS = TANK.flatMap((row, r) => [...row].flatMap((ch, c) => (ch === "X" ? [[c * 10 + 5, r * 10 + 5]] : [])));

export function TankGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 70 70" className={className} aria-hidden>
      {TANK_DOTS.map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r={4.2} fill={y === 5 ? "var(--color-red)" : "var(--color-fg)"} />
      ))}
    </svg>
  );
}
