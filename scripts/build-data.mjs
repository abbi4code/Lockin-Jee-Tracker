// Packs research/*.json into the compact src/data/jee.json the app ships with.
// Runs automatically before `npm run dev` and `npm run build`.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(join(ROOT, "research", f), "utf8"));
const round = (n, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

const SUBJECTS = [
  { id: "physics", file: "physics", name: "Physics", short: "Phy" },
  { id: "chemistry", file: "chemistry", name: "Chemistry", short: "Chem" },
  { id: "maths", file: "maths", name: "Maths", short: "Math" },
];

function youtubeId(url) {
  const m = url?.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

const subjects = SUBJECTS.map(({ id, file, name, short }) => {
  const chapters = read(`chapters-${file}.json`);
  const topics = new Map(read(`topics-${file}.json`).chapters.map((c) => [c.id, c.topics]));
  const weight = new Map(read(`weightage-${file}.json`).chapters.map((c) => [c.id, c]));
  const res = new Map(read(`resources-${file}.json`).chapters.map((c) => [c.id, c]));

  return {
    id,
    name,
    short,
    units: chapters.units.map((u) => ({ id: u.id, name: u.name })),
    chapters: chapters.chapters.map((c) => {
      const w = weight.get(c.id);
      const r = res.get(c.id);
      return {
        id: c.id,
        name: c.name,
        unit: c.unit_id,
        branch: c.branch,
        cls: c.class,
        inMain: c.in_main,
        inAdv: c.in_advanced,
        difficulty: c.difficulty,
        ncertCritical: c.ncert_critical,
        notes: c.notes,
        prereqs: c.prerequisites,
        topics: (topics.get(c.id) ?? []).map((t) => ({
          name: t.name,
          inMain: t.in_main,
          inAdv: t.in_advanced,
          ...(t.main_note ? { mainNote: t.main_note, mainQs: t.main_questions_2024_2026 } : {}),
        })),
        weight: w && {
          main: round(w.main?.avg_questions_per_shift),
          adv: round(w.advanced?.avg_questions),
          mainByYear: w.main?.by_year ?? {},
          highYield: !!w.high_yield,
          roi: w.roi,
          roiReason: w.roi_reason,
          confidence: w.confidence,
        },
        res: r && {
          videos: (r.videos ?? []).map((v) => ({ title: v.title, url: v.url, yt: youtubeId(v.url), channel: v.channel, lang: v.language, duration: v.duration })),
          notes: (r.notes ?? []).map((n) => ({ title: n.title, url: n.url })),
          ncertUseful: r.ncert_useful,
          books: (r.books ?? []).map((b) => ({ name: b.name, section: b.section })),
        },
      };
    }),
  };
});

const facts = read("exam-facts.json");
const exams = facts.dates
  .filter((d) => d.kind === "exam")
  .map((d) => ({ event: d.event, start: d.start, end: d.end, status: d.source_type }));

const tracks = read("testseries-mathongo.json").tracks;
const out = { generatedAt: new Date().toISOString().slice(0, 10), exams, subjects, tracks };
// One-time import of the old Excel tracker (used only by the admin panel's import action).
writeFileSync(join(ROOT, "src", "data", "excel-snapshot.json"), JSON.stringify(read("excel-snapshot.json")));

// College ladder for the daily/weekly "college" game: every entry on one JEE Main CRL scale.
// IITs (Advanced ranks) are scaled by research/colleges-iit.json's adv_to_main; BITS use their researched main_equiv.
const COLLEGE_FILES = ["colleges-iit.json", "colleges-nit.json", "colleges-iiit-bits.json"];
// IIIT Bangalore's 5-year iMTech duplicates its new 4-year B.Tech; every other entry is a B.Tech.
const COLLEGE_SKIP = new Set(["iiitb-cse", "iiitb-ece"]);
let colleges = COLLEGE_FILES.filter((f) => existsSync(join(ROOT, "research", f))).flatMap((f) => {
  const file = read(f);
  const a2m = file.adv_to_main;
  // Banded factors would jump at band edges (Adv 1000 × 2.5 > Adv 1001 × 2.0) and reorder colleges, so the factor
  // slides smoothly between band midpoints (linear in log rank), keeping the converted ranks in order.
  const anchors = (a2m?.bands ?? []).map((b, i, all) => ({ at: Math.log(Math.sqrt((all[i - 1]?.adv_max ?? 100) * b.adv_max)), factor: b.factor }));
  const advFactor = (rank) => {
    if (!anchors.length) return a2m?.factor ?? 2;
    const x = Math.log(rank);
    if (x <= anchors[0].at) return anchors[0].factor;
    const i = anchors.findIndex((a) => a.at >= x);
    if (i === -1) return anchors.at(-1).factor;
    const [a, b] = [anchors[i - 1], anchors[i]];
    return a.factor + ((x - a.at) / (b.at - a.at)) * (b.factor - a.factor);
  };
  return file.entries.map((e) => {
    const rank = e.exam === "advanced" ? e.closing * advFactor(e.closing) : e.exam === "bitsat" ? e.main_equiv : e.closing;
    return rank == null ? null : { id: e.id, short: e.short, type: e.type, branch: e.branch_short, exam: e.exam, closing: e.closing, rank: Math.round(rank) };
  });
}).filter((c) => c && !COLLEGE_SKIP.has(c.id));
// BITS ranks are estimates (BITSAT score → Main rank, ±2×); keep them inside the range the real JoSAA cutoffs span,
// so a rough guess never becomes the ladder's top or bottom.
const officialMax = Math.max(...colleges.filter((c) => c.exam !== "bitsat").map((c) => c.rank));
colleges = colleges.filter((c) => c.exam !== "bitsat" || c.rank <= officialMax).sort((a, b) => a.rank - b.rank);
writeFileSync(join(ROOT, "src", "data", "colleges.json"), JSON.stringify(colleges));
console.log(`src/data/colleges.json: ${colleges.length} college-branches`);

const json = JSON.stringify(out);
writeFileSync(join(ROOT, "src", "data", "jee.json"), json);
const chapterCount = subjects.reduce((n, s) => n + s.chapters.length, 0);
console.log(`src/data/jee.json: ${chapterCount} chapters, ${(json.length / 1024).toFixed(0)} KB`);
