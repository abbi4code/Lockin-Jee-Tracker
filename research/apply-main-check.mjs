// Applies research/evidence/main-check-<subject>.json to topics-<subject>.json (and chapter flags).
// Rule: a topic flagged Advanced-only that was asked 2+ times in JEE Main 2024–26 becomes Main + Advanced,
// with a main_note saying it isn't named in the NTA syllabus but is still asked.
//   node research/apply-main-check.mjs maths physics chemistry

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const MIN_QUESTIONS = 2;
const read = (f) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const write = (f, d) => writeFileSync(join(DIR, f), JSON.stringify(d, null, 2) + "\n");

for (const subject of process.argv.slice(2)) {
  const evidenceFile = `evidence/main-check-${subject}.json`;
  if (!existsSync(join(DIR, evidenceFile))) {
    console.log(`${subject}: no ${evidenceFile}, skipped`);
    continue;
  }
  const evidence = read(evidenceFile);
  const topics = read(`topics-${subject}.json`);
  const chapters = read(`chapters-${subject}.json`);
  const byChapter = new Map(topics.chapters.map((c) => [c.id, c]));

  let flipped = 0;
  const missing = [];
  for (const e of evidence.topics) {
    const topic = byChapter.get(e.chapter_id)?.topics.find((t) => t.name === e.topic);
    if (!topic) {
      missing.push(`${e.chapter_id} | ${e.topic}`);
      continue;
    }
    const counts = [e.main_2024, e.main_2025, e.main_2026];
    const total = counts.reduce((sum, n) => sum + (n ?? 0), 0);
    topic.main_questions_2024_2026 = counts.every((n) => n === null) ? null : total;
    if (total >= MIN_QUESTIONS && !topic.in_main) {
      topic.in_main = true;
      topic.main_note = `Not named in the NTA 2026 syllabus, but asked in JEE Main 2024–26 (${total} questions).`;
      flipped++;
    }
  }

  // A chapter is in Main if any of its topics is.
  const promoted = [];
  for (const ch of chapters.chapters) {
    if (!ch.in_main && byChapter.get(ch.id)?.topics.some((t) => t.in_main)) {
      ch.in_main = true;
      ch.notes = [ch.notes, "Part of this chapter is still in JEE Main (asked in 2024–26 papers or listed in Main's practical unit); the topics marked Main show which."]
        .filter(Boolean)
        .join(" ");
      promoted.push(ch.id);
    }
  }

  write(`topics-${subject}.json`, topics);
  write(`chapters-${subject}.json`, chapters);
  console.log(`${subject}: ${flipped} topic(s) now Main + Advanced; chapters promoted to Main: ${promoted.join(", ") || "none"}`);
  if (missing.length) console.log(`  ⚠️  ${missing.length} evidence row(s) didn't match a topic:\n   ${missing.join("\n   ")}`);
}
