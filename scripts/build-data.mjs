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

// College ladder for the weekly "college" game: every entry on one JEE Main CRL scale.
// IITs (Advanced ranks) are scaled by research/colleges-iit.json's adv_to_main; BITS and colleges with their own
// exam (exam "other": VITEEE, MET, WBJEE...) use the researched main_equiv, flagged as an estimate.
const COLLEGE_FILES = ["colleges-iit.json", "colleges-nit.json", "colleges-iiit-bits.json", "colleges-gfti.json", "colleges-state.json", "colleges-private.json", "colleges-lowrank.json"];
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
    const estimate = e.exam === "bitsat" || e.exam === "other";
    const rank = e.exam === "advanced" ? e.closing * advFactor(e.closing) : estimate ? e.main_equiv : e.closing;
    if (rank == null || !Number.isFinite(rank) || rank <= 0) return null;
    return { id: e.id, short: e.short, type: e.type, branch: e.branch_short, exam: e.exam, closing: e.closing, rank: Math.round(rank), ...(estimate ? { estimate: true } : {}) };
  });
}).filter((c) => c && !COLLEGE_SKIP.has(c.id));
// BITS ranks are estimates (BITSAT score → Main rank, ±2×); keep them inside the range the real JoSAA cutoffs span,
// so a rough guess never becomes the ladder's top or bottom.
// The same goes for other own-exam estimates: none may sit beyond the deepest real (JEE-rank) cutoff.
const officialMax = Math.max(...colleges.filter((c) => !c.estimate).map((c) => c.rank));
const seen = new Set();
colleges = colleges
  .filter((c) => !c.estimate || c.rank <= officialMax)
  // An id in two research files: keep the first (the older, curated files come first).
  .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
  .sort((a, b) => a.rank - b.rank);
writeFileSync(join(ROOT, "src", "data", "colleges.json"), JSON.stringify(colleges));
console.log(`src/data/colleges.json: ${colleges.length} college-branches`);

// Quizrr (MathonGo's test platform): QRT and QPT with parsed syllabi and suggested dates; the full tests are
// listed as "coming soon". A separate file so only the pages that show tests load it.
writeFileSync(join(ROOT, "src", "data", "quizrr.json"), JSON.stringify(buildQuizrr(new Set(subjects.flatMap((s) => s.chapters.map((c) => c.id))))));

function buildQuizrr(chapterIds) {
  const map = read("tests/quizrr-map.json");
  const draft = read("tests/quizrr-schedule.json").dates;
  const SUBJECT = { physics: "physics", chemistry: "chemistry", maths: "maths", mathematics: "maths" };
  const lookup = Object.fromEntries(Object.entries(map.names).map(([s, names]) => [s, new Map(Object.entries(names).map(([n, ids]) => [n.toLowerCase(), ids]))]));
  for (const [s, names] of Object.entries(map.names)) for (const [n, ids] of Object.entries(names)) for (const id of ids) if (!chapterIds.has(id)) throw new Error(`quizrr-map: "${n}" (${s}) → unknown chapter id ${id}`);
  const unknown = [];
  const SERIES = [
    { id: "qrt", files: ["qrt.json"], name: "QRT", title: "revision tests", active: true },
    { id: "qpt", files: ["qpt.json"], name: "QPT", title: "part tests", active: true },
    { id: "qft11", files: ["qft-11.json"], name: "QFT 11", title: "full tests · class 11", active: false },
    { id: "qft", files: ["qft-12.json", "qft-12-2.json"], name: "QFT", title: "full tests · class 11 + 12", active: false },
  ];
  const tests = [];
  for (const s of SERIES) {
    const raw = s.files.flatMap((f) => read(`tests/${f}`).data.subgroups.flatMap((g) => g.tests.map((x) => x.test)));
    raw.forEach((t, i) => {
      // QFT class 11 has no shortTitle; its number is the end of the title.
      const no = Number((t.shortTitle ?? t.title).match(/(\d+)\s*$/)?.[1] ?? (t.title.match(/(\d+)/g) ?? []).at(-1) ?? i + 1);
      const id = `${s.id}-${no}`;
      tests.push({
        id,
        series: s.id,
        no,
        quizrrId: t._id,
        questions: t.totalQuestions,
        minutes: t.totalTime,
        marks: t.totalMarks,
        // Release time (UTC; 03:30Z = 9:00 am IST). QRT and QPT 1–10 are already out; QPT 11–13 open on this date.
        opensAt: s.active ? t.startDate : null,
        accessEnds: t.endDate ?? null,
        syllabus: s.active ? parseSyllabus(t.syllabus, id) : { kind: "full", cls: s.id === "qft11" ? 11 : null },
        suggested: draft[id] ?? null,
      });
    });
  }
  function parseSyllabus(html, testId) {
    const whole = html.match(/complete class (11|12)/i);
    if (whole) return { kind: "class", cls: Number(whole[1]) };
    const subjects = [];
    let subject = null;
    // Two formats: <h2>Physics</h2><ul><li>A</li></ul> (QRT) and <h2>Physics</h2>A<br>B (QPT).
    for (const part of html.split(/(<h2>.*?<\/h2>)/)) {
      const h = part.match(/<h2>(.*?)<\/h2>/);
      if (h) {
        subject = SUBJECT[h[1].trim().toLowerCase()];
        if (!subject) throw new Error(`${testId}: unknown subject heading "${h[1]}"`);
        subjects.push({ subject, items: [] });
        continue;
      }
      if (!subject) continue;
      for (const name of part.split(/<br\s*\/?>|<\/?li>|<\/?ul>/).map((x) => x.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim()).filter(Boolean)) {
        const override = map.overrides[testId]?.[subject]?.[name];
        const ids = override ?? lookup[subject].get(name.toLowerCase());
        if (!ids) unknown.push(`${testId} · ${subject}: "${name}"`);
        subjects.at(-1).items.push({ name, ids: ids ?? [] });
      }
    }
    return { kind: "chapters", subjects };
  }
  if (unknown.length) throw new Error(`Quizrr chapter names missing from research/tests/quizrr-map.json:\n  ${unknown.join("\n  ")}`);
  for (const [id, date] of Object.entries(draft)) {
    const t = tests.find((x) => x.id === id);
    if (!t) throw new Error(`quizrr-schedule: unknown test ${id}`);
    if (t.opensAt && date < new Date(t.opensAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })) throw new Error(`quizrr-schedule: ${id} on ${date} is before it opens`);
  }
  console.log(`src/data/quizrr.json: ${tests.length} quizrr tests, ${Object.keys(draft).length} with suggested dates`);
  return { series: SERIES.map(({ files, ...s }) => s), tests };
}

const json = JSON.stringify(out);
writeFileSync(join(ROOT, "src", "data", "jee.json"), json);
const chapterCount = subjects.reduce((n, s) => n + s.chapters.length, 0);
console.log(`src/data/jee.json: ${chapterCount} chapters, ${(json.length / 1024).toFixed(0)} KB`);
