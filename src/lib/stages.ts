/** The chapter pipeline, taken from the old Excel board: Undone → … → Adv level. */
export const STAGES = [
  { id: "undone", label: "undone", short: "undone" },
  { id: "working", label: "on working", short: "working" },
  { id: "ready", label: "test ready", short: "ready" },
  { id: "testing", label: "test", short: "test" },
  { id: "weak", label: "weak", short: "weak" },
  { id: "mains", label: "mains level", short: "mains" },
  { id: "adv", label: "adv level", short: "adv" },
] as const;

export type Status = (typeof STAGES)[number]["id"];

export const stageIndex = (s: Status) => STAGES.findIndex((x) => x.id === s);
export const stageLabel = (s: Status) => STAGES.find((x) => x.id === s)?.label ?? s;

/** Studied = past "on working": counts as covered for syllabus %, pace and revision. */
export const isStudied = (s: Status) => stageIndex(s) >= stageIndex("ready");

/** Maps the old three-state status (and anything unknown) onto the pipeline. */
export function normalizeStatus(s: unknown): Status {
  if (s === "todo") return "undone";
  if (s === "doing") return "working";
  if (s === "done") return "ready";
  return STAGES.some((x) => x.id === s) ? (s as Status) : "undone";
}
