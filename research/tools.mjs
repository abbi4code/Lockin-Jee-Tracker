// Helpers for the research JSON files.
//   node research/tools.mjs ids <maths|physics|chemistry>   print the chapter id list to paste into prompts
//   node research/tools.mjs validate                        check every research file
//   node research/tools.mjs prompt <step> [subject]         fill a prompt from prompts.md and copy it to the clipboard
//   node research/tools.mjs split [jee-data.json]           split the all-in-one file into per-subject files

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const SUBJECTS = { maths: "math-", physics: "phy-", chemistry: "chem-" };
const PER_SUBJECT = ["chapters", "topics", "weightage", "resources"];
const SINGLE = ["exam-facts", "score-tables"];
const SOURCE_TYPES = ["official", "coaching_analysis", "coaching_estimate", "estimate", "expected"];

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

// Load files, grouping continuation parts (chapters-physics.json, chapters-physics-2.json, …).
function loadAll() {
  const groups = {};
  const pattern = new RegExp(
    `^(${[...PER_SUBJECT, ...SINGLE].join("|")})(?:-(${Object.keys(SUBJECTS).join("|")}))?(?:-(\\d+))?\\.json$`
  );
  for (const name of readdirSync(DIR).sort()) {
    if (!name.endsWith(".json") || name === "jee-data.json") continue;
    const m = name.match(pattern);
    if (!m) {
      warn(name, "unrecognised filename, skipped");
      continue;
    }
    const [, kind, subject, part] = m;
    if (PER_SUBJECT.includes(kind) && !subject) {
      warn(name, `expected ${kind}-<maths|physics|chemistry>.json, skipped`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(readFileSync(join(DIR, name), "utf8"));
    } catch (e) {
      err(name, `invalid JSON: ${e.message}`);
      continue;
    }
    const key = subject ? `${kind}-${subject}` : kind;
    (groups[key] ??= { kind, subject, parts: [] }).parts.push({ name, data, part: Number(part ?? 1) });
  }
  for (const g of Object.values(groups)) g.parts.sort((a, b) => a.part - b.part);
  return groups;
}

// Merge continuation parts: arrays are concatenated, everything else comes from the first part.
function merge(parts) {
  const out = {};
  for (const { data } of parts) {
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) out[k] = [...(out[k] ?? []), ...v];
      else if (!(k in out)) out[k] = v;
    }
  }
  return out;
}

function checkSourceTypes(file, value, path = "") {
  if (Array.isArray(value)) value.forEach((v, i) => checkSourceTypes(file, v, `${path}[${i}]`));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "source_type" && v !== null && !SOURCE_TYPES.includes(v)) {
        err(file, `${path}.source_type "${v}" is not one of ${SOURCE_TYPES.join(", ")}`);
      }
      checkSourceTypes(file, v, `${path}.${k}`);
    }
  }
}

function validateChapters(groups) {
  const all = new Map(); // id -> { chapter, file }
  for (const subject of Object.keys(SUBJECTS)) {
    const g = groups[`chapters-${subject}`];
    if (!g) continue;
    const file = `chapters-${subject}`;
    const data = merge(g.parts);
    const unitIds = new Set((data.units ?? []).map((u) => u.id));
    if (!Array.isArray(data.chapters)) {
      err(file, `"chapters" must be an array`);
      continue;
    }
    for (const c of data.chapters) {
      const where = `${file} ${c.id ?? "(no id)"}`;
      if (typeof c.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)) err(where, "id must be kebab-case");
      else if (!c.id.startsWith(SUBJECTS[subject])) err(where, `id must start with ${SUBJECTS[subject]}`);
      if (all.has(c.id)) err(where, `duplicate id (also in ${all.get(c.id).file})`);
      all.set(c.id, { chapter: c, file });
      if (!c.name) err(where, "missing name");
      if (!unitIds.has(c.unit_id)) err(where, `unit_id "${c.unit_id}" not in units`);
      if (![11, 12].includes(c.class)) err(where, `class must be 11 or 12, got ${c.class}`);
      if (typeof c.in_main !== "boolean" || typeof c.in_advanced !== "boolean") err(where, "in_main/in_advanced must be booleans");
      else if (!c.in_main && !c.in_advanced) err(where, "in neither Main nor Advanced");
      if (c.difficulty !== null && !(Number.isInteger(c.difficulty) && c.difficulty >= 1 && c.difficulty <= 5)) err(where, "difficulty must be 1–5 or null");
      const branches = subject === "chemistry" ? ["physical", "organic", "inorganic"] : [null];
      if (!branches.includes(c.branch)) err(where, `branch must be ${branches.map(String).join("/")}, got ${c.branch}`);
      if (c.vmc_order !== null && c.vmc_order !== undefined && typeof c.vmc_order !== "number") err(where, "vmc_order must be a number or null");
      if (!Array.isArray(c.prerequisites)) err(where, "prerequisites must be an array");
    }
    const n = data.uncertainties?.length ?? 0;
    if (n) warn(file, `${n} uncertainties to review`);
  }

  // Prerequisites resolve against every subject, so Physics can depend on Maths.
  for (const [id, { chapter, file }] of all) {
    for (const p of chapter.prerequisites ?? []) {
      if (p === id) err(`${file} ${id}`, "lists itself as a prerequisite");
      else if (!all.has(p)) {
        const subjectOfP = Object.entries(SUBJECTS).find(([, prefix]) => p.startsWith(prefix))?.[0];
        const loaded = subjectOfP && groups[`chapters-${subjectOfP}`];
        (loaded ? err : warn)(`${file} ${id}`, `prerequisite "${p}" not found${loaded ? "" : ` (chapters-${subjectOfP ?? "?"} not loaded yet)`}`);
      }
    }
  }

  // Cycle check on the prerequisite graph.
  const state = new Map();
  const visit = (id, stack) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "active") {
      err("chapters", `prerequisite cycle: ${[...stack.slice(stack.indexOf(id)), id].join(" → ")}`);
      return;
    }
    state.set(id, "active");
    for (const p of all.get(id)?.chapter.prerequisites ?? []) if (all.has(p)) visit(p, [...stack, id]);
    state.set(id, "done");
  };
  for (const id of all.keys()) visit(id, []);

  return all;
}

function validateLinked(groups, chapters) {
  for (const kind of ["topics", "weightage", "resources"]) {
    for (const subject of Object.keys(SUBJECTS)) {
      const g = groups[`${kind}-${subject}`];
      if (!g) continue;
      const file = `${kind}-${subject}`;
      const data = merge(g.parts);
      if (!groups[`chapters-${subject}`]) {
        warn(file, `chapters-${subject}.json not loaded, so ids can't be checked`);
        continue;
      }
      const seen = new Set();
      for (const c of data.chapters ?? []) {
        const where = `${file} ${c.id}`;
        if (!chapters.has(c.id)) err(where, "id not in Step 1 chapters");
        if (seen.has(c.id)) err(where, "duplicate id");
        seen.add(c.id);
        if (kind === "topics") {
          if (!Array.isArray(c.topics) || c.topics.length === 0) err(where, "no topics");
          for (const t of c.topics ?? []) {
            if (!t.name) err(where, "topic without a name");
            if (typeof t.in_main !== "boolean" || typeof t.in_advanced !== "boolean") err(where, `topic "${t.name}" needs boolean in_main/in_advanced`);
          }
        }
        if (kind === "weightage") {
          if (c.roi !== null && !(Number.isInteger(c.roi) && c.roi >= 1 && c.roi <= 5)) err(where, "roi must be 1–5 or null");
          if (!["high", "medium", "low"].includes(c.confidence)) err(where, "confidence must be high/medium/low");
        }
      }
      const missing = [...chapters.values()]
        .filter(({ file: f }) => f === `chapters-${subject}`)
        .map(({ chapter }) => chapter.id)
        .filter((id) => !seen.has(id));
      if (missing.length) warn(file, `no entry for ${missing.length} chapter(s): ${missing.join(", ")}`);
      const n = data.uncertainties?.length ?? 0;
      if (n) warn(file, `${n} uncertainties to review`);
    }
  }
}

function validate() {
  const groups = loadAll();
  for (const g of Object.values(groups)) for (const p of g.parts) checkSourceTypes(p.name, p.data);
  const chapters = validateChapters(groups);
  validateLinked(groups, chapters);
  for (const kind of SINGLE) {
    const n = groups[kind] && merge(groups[kind].parts).uncertainties?.length;
    if (n) warn(kind, `${n} uncertainties to review`);
  }

  const loaded = Object.values(groups).flatMap((g) => g.parts.map((p) => p.name));
  console.log(`Loaded ${loaded.length} file(s)${loaded.length ? `: ${loaded.join(", ")}` : ""}`);
  console.log(`${chapters.size} chapter(s) across all subjects\n`);
  for (const w of warnings) console.log(`⚠️  ${w}`);
  for (const e of errors) console.log(`❌ ${e}`);
  if (!errors.length) console.log(`${warnings.length ? "\n" : ""}✅ No errors`);
  process.exit(errors.length ? 1 : 0);
}

function chapterList(subject) {
  const g = loadAll()[`chapters-${subject}`];
  if (!g) fail(`No chapters-${subject}.json in research/ yet. Run Step 1 for ${subject} first.`);
  const data = merge(g.parts);
  const units = Object.fromEntries((data.units ?? []).map((u) => [u.id, u.name]));
  return data.chapters
    .map((c) => {
      const exams = [c.in_main && "Main", c.in_advanced && "Adv"].filter(Boolean).join("+");
      return `${c.id} | ${c.name} | ${units[c.unit_id] ?? c.unit_id} | Class ${c.class} | ${exams}`;
    })
    .join("\n");
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function ids(subject) {
  if (!SUBJECTS[subject]) fail(`Usage: node research/tools.mjs ids <${Object.keys(SUBJECTS).join("|")}>`);
  console.log(chapterList(subject));
}

// Build a ready-to-paste prompt from prompts.md and copy it to the clipboard.
const STEPS = { 1: true, 2: true, 3: true, 5: true, "4a": false, "4b": false }; // true = needs a subject
const SUBJECT_TITLES = { maths: "Mathematics", physics: "Physics", chemistry: "Chemistry" };

function prompt(step, subject) {
  const usage = "Usage: node research/tools.mjs prompt <1|2|3|4a|4b|5> [maths|physics|chemistry]";
  if (!(step in STEPS)) fail(usage);
  if (STEPS[step] && !SUBJECTS[subject]) fail(usage);

  // The prompt is the first fenced block after the "## Step <n>" heading.
  const md = readFileSync(join(DIR, "prompts.md"), "utf8");
  const section = md.split(/^## /m).find((s) => s.startsWith(`Step ${step} `));
  const block = section?.match(/^```\n([\s\S]*?)\n```$/m);
  if (!block) fail(`Couldn't find the Step ${step} prompt in prompts.md`);
  let text = block[1];

  if (STEPS[step]) {
    if (text.includes("{{MATHS CHAPTER LIST}}")) {
      if (subject === "maths") {
        // Maths goes first, so drop the paragraph that points at Maths ids.
        text = text.replace(/\nThese are the Maths chapter ids[\s\S]*?\{\{MATHS CHAPTER LIST\}\}\n/, "");
      } else {
        text = text.replaceAll("{{MATHS CHAPTER LIST}}", chapterList("maths"));
      }
    }
    if (text.includes("{{CHAPTER LIST}}")) text = text.replaceAll("{{CHAPTER LIST}}", chapterList(subject));
    text = text
      .replaceAll("{{SUBJECT}}", SUBJECT_TITLES[subject])
      .replaceAll("{{subject}}", subject)
      .replaceAll('"subject": "physics"', `"subject": "${subject}"`);
  }

  const left = text.match(/\{\{[^}]+\}\}/g);
  if (left) fail(`Unfilled placeholders: ${[...new Set(left)].join(", ")}`);

  const copied = spawnSync("pbcopy", { input: text }).status === 0;
  console.log(text);
  console.error(`\n${copied ? "📋 Copied to clipboard. " : ""}Paste it into a NEW browser Claude chat.`);
}

// Split the all-in-one jee-data.json into the per-subject files the validator reads.
function split(name = "jee-data.json") {
  const path = join(DIR, name);
  if (!existsSync(path)) fail(`No ${name} in research/ yet`);
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`${name} is not valid JSON: ${e.message}`);
  }
  const written = [];
  const skipped = [];
  const isEmpty = (obj) => !obj || Object.values(obj).every((v) => v == null || (typeof v === "object" && Object.keys(v).length === 0));
  const write = (file, obj) => {
    if (isEmpty(obj)) return skipped.push(file);
    writeFileSync(join(DIR, file), JSON.stringify(obj, null, 2) + "\n");
    written.push(file);
  };
  for (const kind of PER_SUBJECT) {
    for (const [subject, obj] of Object.entries(data[kind] ?? {})) {
      if (!SUBJECTS[subject]) {
        console.error(`⚠️  skipped ${kind}.${subject}: unknown subject`);
        continue;
      }
      write(`${kind}-${subject}.json`, isEmpty(obj) ? obj : { subject, ...obj });
    }
  }
  if (data.exam_facts) write("exam-facts.json", data.exam_facts);
  if (data.score_tables) write("score-tables.json", data.score_tables);
  console.log(`Wrote ${written.length} file(s): ${written.join(", ")}`);
  if (skipped.length) console.log(`Skipped ${skipped.length} empty section(s): ${skipped.join(", ")}`);
  console.log("Now run: node research/tools.mjs validate");
}

const [cmd, arg, arg2] = process.argv.slice(2);
if (cmd === "validate") validate();
else if (cmd === "ids") ids(arg);
else if (cmd === "prompt") prompt(arg, arg2);
else if (cmd === "split") split(arg);
else fail("Usage: node research/tools.mjs <validate | ids <subject> | prompt <step> [subject] | split [file]>");
