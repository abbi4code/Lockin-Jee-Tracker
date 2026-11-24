import { biggestReason, needsAnalysis, REASONS, type Analysis } from "@/lib/analysis";

/** One line for an admin table: the biggest reason and the split, or that it's still missing. */
export function analysisLine(r: { analysis?: Analysis | null; score: number | null; takenOn: string | null; imported?: boolean }, today: string) {
  const a = r.analysis;
  if (!a) return needsAnalysis(r, today) ? <span className="text-red">not analysed yet</span> : <span className="text-dim">no analysis</span>;
  const top = biggestReason(a);
  return (
    <span className="text-mute" title={a.note || undefined}>
      {top
        ? REASONS.filter((x) => a[x.id])
            .map((x) => `${x.label} ${a[x.id]}`)
            .join(" · ")
        : "analysed, nothing sorted"}
      {a.note ? " · ✎" : ""}
    </span>
  );
}
