# Research prompts for browser Claude

> **Easiest way:** paste [all-in-one-prompt.md](all-in-one-prompt.md) into browser Claude. It does every remaining step and returns one `jee-data.json`.
> Save that file in `research/`, then run `node research/tools.mjs split` followed by `node research/tools.mjs validate`.
> The step-by-step prompts below are the fallback if the all-in-one run gets cut short or comes back thin.

**Don't paste this file into browser Claude.** It's the template the commands below read from.

To get a ready-to-paste prompt (placeholders filled, copied to your clipboard):

```
node research/tools.mjs prompt 1 maths      # then: prompt 1 physics, prompt 1 chemistry
node research/tools.mjs prompt 2 physics    # steps 2, 3, 5 take a subject
node research/tools.mjs prompt 4a           # steps 4a, 4b don't
```

Run these in order, with web search on. Start a **new chat** for each prompt.
Save every JSON reply into `research/` using the filename given in the step.

**If a reply ends with `CONTINUE`**, type `continue` and save the next block with a number on the end:
`chapters-physics.json`, then `chapters-physics-2.json`, `chapters-physics-3.json` …
The validator merges the parts for you.

After you save a file, run:

```
node research/tools.mjs validate
```

It checks that the JSON parses, that ids are unique, that every prerequisite exists and that every id in later steps matches Step 1.

| Step | What | Runs | Files |
|------|------|------|-------|
| 1 | Chapter map | 3× in this order: **Maths → Physics → Chemistry** | `chapters-maths.json`, `chapters-physics.json`, `chapters-chemistry.json` |
| 2 | Topics per chapter | 3× | `topics-<subject>.json` |
| 3 | Weightage per chapter | 3× | `weightage-<subject>.json` |
| 4a | Dates, paper patterns, eligibility | 1× | `exam-facts.json` |
| 4b | Marks → percentile → rank tables | 1× | `score-tables.json` |
| 5 | Resources per chapter (optional) | 3× | `resources-<subject>.json` |

**Placeholders** (the `prompt` command fills these in for you)

- `{{SUBJECT}}` / `{{subject}}`: the subject name
- `{{CHAPTER LIST}}` / `{{MATHS CHAPTER LIST}}`: chapter ids from the saved Step 1 files. This is why Step 1 must be run and saved before the later steps.

---

## Output rules (already included in every prompt below)

```
Output rules:
- Reply with strict, valid JSON in a single ```json code block: no comments, no trailing commas, double quotes only.
- Unknown means null. Never guess a number, date, name or URL. List every gap under "uncertainties".
- If you're about to run out of space, stop at a chapter boundary, close the JSON so it's still valid, and write CONTINUE on its own line after the code block. When I reply "continue", send the next block in the same shape, starting from the next chapter.
```

---

## Step 1 — Chapter map (run once per subject: Maths, then Physics, then Chemistry)

For the Physics and Chemistry runs, paste the Maths id list where it says `{{MATHS CHAPTER LIST}}`. For the Maths run, delete that paragraph.

```
I'm building a study-tracker app for my younger brother. He's in Class 12 and preparing for JEE Main 2027 and JEE Advanced 2027 at Vidyamandir Classes (VMC). I need an accurate chapter-level map of {{SUBJECT}} that I can load straight into the app's database. This step covers chapters only; topics come in a later step.

Use web search. Treat the official syllabi as the ground truth:
- JEE Main: the latest syllabus published by NTA (jeemain.nta.nic.in). NTA revised and cut the syllabus from 2024 onward.
- JEE Advanced: the latest syllabus on the official JEE Advanced site (jeeadv.ac.in).
If the 2027 syllabus isn't out yet, use the most recent official one and say which year it is.

These are the Maths chapter ids already in my app. If a {{SUBJECT}} chapter depends on Maths (vectors, calculus, trigonometry, logarithms…), use these ids in its prerequisites:
{{MATHS CHAPTER LIST}}

For every chapter in {{SUBJECT}} that appears in JEE Main, JEE Advanced or both, give:
- id: kebab-case with the subject prefix (math-, phy- or chem-), for example "phy-rotational-motion". Keep it short and stable, because later steps reference it.
- unit_id: the unit it belongs to. Define the units in the "units" list.
- branch: for Chemistry, one of "physical", "organic" or "inorganic". For other subjects, null.
- class: 11 or 12, based on the NCERT book it belongs to.
- ncert_chapter: for example "Class 11 Part 1, Ch 7", or null.
- in_main / in_advanced: check each chapter against both official syllabi. Several chapters and topics were removed from Main in 2024 but are still in Advanced. Don't go from memory.
- vmc_name / vmc_order: how VMC names and orders the chapter in its Class 11 or 12 JEE program, if you can find that publicly (VMC website, study material listings, student forums, topper blogs). vmc_order is the position within that class year. If you can't confirm it, use null. Don't guess.
- prerequisites: ids of the chapters you really need to know first. Only use ids from this reply or from the Maths list above.
- difficulty: 1 (easy) to 5 (very hard), based on how JEE aspirants and teachers commonly describe the chapter.
- ncert_critical: true if the NCERT text itself is especially important (common for Inorganic Chemistry).
- notes: anything notable, for example "removed from Main in 2024", or null.

Output a JSON object in exactly this shape. It will be saved as chapters-{{subject}}.json:

{
  "subject": "physics",
  "syllabus_sources": [
    { "exam": "main", "year": 2026, "url": "https://..." },
    { "exam": "advanced", "year": 2026, "url": "https://..." }
  ],
  "units": [
    { "id": "phy-mechanics", "name": "Mechanics" }
  ],
  "chapters": [
    {
      "id": "phy-rotational-motion",
      "name": "Rotational Motion",
      "unit_id": "phy-mechanics",
      "branch": null,
      "class": 11,
      "ncert_chapter": "Class 11 Part 1, Ch 7",
      "in_main": true,
      "in_advanced": true,
      "vmc_name": null,
      "vmc_order": null,
      "prerequisites": ["phy-laws-of-motion", "math-vector-algebra"],
      "difficulty": 5,
      "ncert_critical": false,
      "notes": null
    }
  ],
  "removed_or_changed": [
    { "item": "Communication Systems", "change": "removed from Main in 2024", "source_url": "https://..." }
  ],
  "uncertainties": []
}

Output rules:
- Reply with strict, valid JSON in a single ```json code block: no comments, no trailing commas, double quotes only.
- Unknown means null. Never guess a number, date, name or URL. List every gap under "uncertainties".
- If you're about to run out of space, stop at a chapter boundary, close the JSON so it's still valid, and write CONTINUE on its own line after the code block. When I reply "continue", send the next block in the same shape, starting from the next chapter.

After the final block, give a short summary: the number of chapters, which ones are Main-only or Advanced-only, and anything surprising.
```

---

## Step 2 — Topics per chapter (run once per subject)

```
I'm building a JEE study tracker for my brother (Class 12, JEE Main + Advanced 2027). Below are the {{SUBJECT}} chapters in my app, with ids. For each one, I need the topics/subtopics from the official syllabi and which exam each topic is in.

{{CHAPTER LIST}}

Use web search. Treat the latest official JEE Main syllabus (NTA, jeemain.nta.nic.in) and JEE Advanced syllabus (jeeadv.ac.in) as the ground truth. A chapter can be in both exams while some of its topics are Advanced-only (or Main-only). Flag each topic on its own.

Keep topic names short (under ~60 characters) and in the order a teacher would cover them. Aim for 4–12 topics per chapter.

Output a JSON object in exactly this shape. It will be saved as topics-{{subject}}.json:

{
  "subject": "physics",
  "chapters": [
    {
      "id": "phy-rotational-motion",
      "topics": [
        { "name": "Moment of inertia", "in_main": true, "in_advanced": true },
        { "name": "Parallel and perpendicular axis theorems", "in_main": true, "in_advanced": true },
        { "name": "Rolling motion", "in_main": true, "in_advanced": true }
      ]
    }
  ],
  "uncertainties": []
}

Use my chapter ids exactly as given. Don't add or rename chapters. If you think one is missing or misplaced, say so under "uncertainties".

Output rules:
- Reply with strict, valid JSON in a single ```json code block: no comments, no trailing commas, double quotes only.
- Unknown means null. Never guess a number, date, name or URL. List every gap under "uncertainties".
- If you're about to run out of space, stop at a chapter boundary, close the JSON so it's still valid, and write CONTINUE on its own line after the code block. When I reply "continue", send the next block in the same shape, starting from the next chapter.
```

---

## Step 3 — Weightage per chapter (run once per subject)

```
I'm building a JEE study tracker for my brother (Class 12, JEE Main + Advanced 2027). Below are the {{SUBJECT}} chapters in my app, with ids. For each chapter, I need to know how many questions it gets in the exam.

{{CHAPTER LIST}}

Use web search. NTA and the IITs do not publish chapter-wise question counts, so nearly all of this comes from coaching institutes' paper analyses (Allen, Aakash, VMC, FIITJEE, Resonance, PW, Mathongo, etc.). Cross-check at least two sources wherever you can, and label every number with where it came from.

For each chapter, give:
1. JEE Main: the average number of questions per shift for each year from 2019 to 2026, plus an overall average. The Main syllabus was cut in 2024, so weight 2024–2026 more heavily in the overall average and say how you did it.
2. JEE Advanced: the total number of questions across Paper 1 + Paper 2 for each year from 2019 to 2026, plus the average.
3. high_yield: true if the chapter is consistently in the top ~30% by number of questions in either exam.
4. roi: 1 to 5, meaning marks gained per hour of study, the way coaching teachers usually rank chapters (for example, Modern Physics is high ROI; Rotation is low ROI but important). Add a one-line reason.
5. confidence: "high" if two or more sources agree, "medium" if there's only one decent source, "low" if the data is thin.

source_type is one of: "official", "coaching_analysis", "estimate". For this step it will almost always be "coaching_analysis".

Output a JSON object in exactly this shape. It will be saved as weightage-{{subject}}.json:

{
  "subject": "physics",
  "chapters": [
    {
      "id": "phy-rotational-motion",
      "main": {
        "avg_questions_per_shift": 1.8,
        "by_year": { "2019": 1.5, "2020": 2, "2021": 1.7, "2022": 1.8, "2023": 2, "2024": 2, "2025": 1.5, "2026": null },
        "source_type": "coaching_analysis"
      },
      "advanced": {
        "by_year": { "2019": 3, "2020": 2, "2021": 2, "2022": 3, "2023": 2, "2024": 3, "2025": 2, "2026": null },
        "avg_questions": 2.4,
        "source_type": "coaching_analysis"
      },
      "high_yield": true,
      "roi": 3,
      "roi_reason": "Heavily tested, but slow to master",
      "confidence": "medium",
      "sources": ["https://...", "https://..."]
    }
  ],
  "method_notes": "how you averaged, and where sources disagreed",
  "uncertainties": []
}

Use my chapter ids exactly as given.

Output rules:
- Reply with strict, valid JSON in a single ```json code block: no comments, no trailing commas, double quotes only.
- Unknown means null. Never guess a number, date, name or URL. List every gap under "uncertainties".
- If you're about to run out of space, stop at a chapter boundary, close the JSON so it's still valid, and write CONTINUE on its own line after the code block. When I reply "continue", send the next block in the same shape, starting from the next chapter.
```

---

## Step 4a — Dates, paper patterns, eligibility (run once)

```
I'm building a JEE study tracker for my brother, who takes JEE Main 2027 and JEE Advanced 2027 (he's in CBSE Class 12). I need exam facts to power a countdown and a mock-test logger. Use web search. Prefer official sources (NTA, jeemain.nta.nic.in, jeeadv.ac.in, JoSAA, CBSE).

Label everything with source_type, which is one of:
- "official": taken from an official notice or information bulletin.
- "coaching_analysis": reported by a coaching institute or education news site.
- "expected": your projection from past years' patterns. Never present an estimate as official.

I need:
1. Dates: JEE Main 2027 Session 1 and Session 2 (exam window, registration window, result), JEE Advanced 2027 (registration, exam, result), and CBSE Class 12 board exams 2027 (theory exam window). If 2027 dates aren't announced, project them from the 2024–2026 pattern and mark them "expected".
2. JEE Main paper pattern (B.E./B.Tech paper), as it applies to 2027 (or the latest year): sections per subject, question types, how many questions must be attempted, and marks for correct, wrong and unattempted answers. Also list changes made in the last 3 years.
3. JEE Advanced patterns for 2023, 2024, 2025 and 2026. The pattern changes every year. For each year, list both papers, and in each paper each subject's sections, with the question type, number of questions, full marks, partial-marking rule and negative marks.
4. Eligibility: the Main cutoff to qualify for Advanced (number of candidates, and category-wise percentile cutoffs for 2023–2025), the Class 12 board criterion for IIT/NIT admission, the Advanced attempt limit and the age limit.

Use these values for question type: "mcq_single", "mcq_multiple", "numerical_integer", "numerical_decimal", "matching_list", "paragraph". Use "other" and explain in "notes" if none fit.

Output a JSON object in exactly this shape. It will be saved as exam-facts.json:

{
  "dates": [
    {
      "event": "JEE Main 2027 Session 1",
      "kind": "exam",
      "start": "2027-01-22",
      "end": "2027-01-31",
      "source_type": "expected",
      "source": "https://..."
    }
  ],
  "main_pattern": {
    "applies_to_year": 2026,
    "duration_minutes": 180,
    "total_marks": 300,
    "subjects": [
      {
        "subject": "physics",
        "sections": [
          { "name": "A", "type": "mcq_single", "questions": 20, "must_attempt": 20, "marks_correct": 4, "marks_wrong": -1, "marks_unattempted": 0, "partial_marking": null, "notes": null }
        ]
      }
    ],
    "recent_changes": [ { "year": 2025, "change": "..." } ],
    "source_type": "official",
    "source": "https://..."
  },
  "advanced_patterns": [
    {
      "year": 2025,
      "papers": [
        {
          "paper": 1,
          "duration_minutes": 180,
          "total_marks": 180,
          "subjects": [
            {
              "subject": "physics",
              "sections": [
                { "name": "1", "type": "mcq_multiple", "questions": 4, "marks_correct": 4, "marks_wrong": -2, "partial_marking": "+3 if all four correct but only three chosen...", "notes": null }
              ]
            }
          ]
        }
      ],
      "source_type": "official",
      "source": "https://..."
    }
  ],
  "eligibility": {
    "advanced_qualifying": {
      "top_candidates": 250000,
      "percentile_cutoffs": [
        { "year": 2025, "general": null, "ews": null, "obc_ncl": null, "sc": null, "st": null, "pwd": null }
      ],
      "source_type": "official",
      "source": "https://..."
    },
    "board_criterion": { "general_percent": 75, "sc_st_percent": 65, "alternative": "top 20 percentile of own board", "source_type": "official", "source": "https://..." },
    "advanced_attempts": { "max_attempts": 2, "rule": "in two consecutive years", "source_type": "official", "source": "https://..." },
    "age_limit": { "rule": "...", "source_type": "official", "source": "https://..." }
  },
  "uncertainties": []
}

Output rules:
- Reply with strict, valid JSON in a single ```json code block: no comments, no trailing commas, double quotes only.
- Unknown means null. Never guess a number, date, name or URL. List every gap under "uncertainties".
- If you're about to run out of space, stop at a section boundary, close the JSON so it's still valid, and write CONTINUE on its own line after the code block. When I reply "continue", send the rest in the same shape.
```

---

## Step 4b — Marks → percentile → rank tables (run once)

```
I'm building a JEE study tracker for my brother (JEE Main + Advanced 2027). He'll log mock-test scores, and the app will estimate his percentile and rank. I need historical score-conversion tables.

Important background, so you label the data correctly:
- NTA publishes each candidate's percentile, but not marks-vs-percentile tables. Percentile is normalised per shift, so the same marks give different percentiles in different shifts. Every public marks-vs-percentile table is a coaching estimate, based either on one shift or on an average across shifts.
- Percentile-vs-rank and Advanced marks-vs-rank tables are also mostly compiled by coaching sites from result data.

So for every table, record:
- source_type: "official", "coaching_analysis" or "estimate"
- basis: which shift or session it refers to, for example "2025 Jan, 22 Jan shift 1", "average across all Jan 2025 shifts" or "final combined NTA score"
- source: the URL

I need:
1. JEE Main marks vs percentile, for 2023, 2024, 2025 and 2026, per session if the sources split it. Use bands of about 10–20 marks across the full 0–300 range.
2. JEE Main percentile vs Common Rank List (CRL) rank for the same years.
3. JEE Advanced marks vs CRL rank for 2023–2026. Also give the maximum marks for that year, since total marks change year to year.

Output a JSON object in exactly this shape. It will be saved as score-tables.json:

{
  "main_marks_vs_percentile": [
    {
      "year": 2025,
      "session": "jan",
      "basis": "average across all Jan 2025 shifts",
      "source_type": "coaching_analysis",
      "source": "https://...",
      "bands": [
        { "marks_min": 281, "marks_max": 300, "percentile_min": 99.99, "percentile_max": 100 }
      ]
    }
  ],
  "main_percentile_vs_rank": [
    {
      "year": 2025,
      "basis": "final combined NTA score",
      "source_type": "coaching_analysis",
      "source": "https://...",
      "bands": [
        { "percentile_min": 99.9, "percentile_max": 100, "rank_min": 1, "rank_max": 1400 }
      ]
    }
  ],
  "advanced_marks_vs_rank": [
    {
      "year": 2025,
      "max_marks": 360,
      "basis": "CRL",
      "source_type": "coaching_analysis",
      "source": "https://...",
      "bands": [
        { "marks_min": 300, "marks_max": 360, "rank_min": 1, "rank_max": 100 }
      ]
    }
  ],
  "uncertainties": []
}

Session is one of "jan", "apr" or "combined".

Output rules:
- Reply with strict, valid JSON in a single ```json code block: no comments, no trailing commas, double quotes only.
- Unknown means null. Never guess a number, date, name or URL. List every gap under "uncertainties".
- If you're about to run out of space, stop after a complete table, close the JSON so it's still valid, and write CONTINUE on its own line after the code block. When I reply "continue", send the next block in the same shape, starting from the next table.
```

---

## Step 5 — Resources per chapter (optional, run once per subject)

```
For my brother's JEE study tracker (Class 12, VMC student, JEE Main + Advanced 2027), I need good free resources for each {{SUBJECT}} chapter below.

{{CHAPTER LIST}}

Use web search. For each chapter, find:
- 1–2 highly rated YouTube one-shots or lecture series (for example PW, Unacademy, Mohit Tyagi, Eduniti, Vedantu, Mathongo, or well-known individual teachers), with URL, channel, language ("hindi", "english" or "hinglish") and approximate length.
- A good formula sheet or short-notes source, if one exists.
- Whether solving NCERT examples/exercises is worthwhile for this chapter.
- The standard practice books JEE toppers recommend for it (for example HC Verma, DC Pandey, Cengage, MS Chauhan, N Awasthi, VK Jaiswal, Black Book), and which chapter or section of each is relevant.

Only include URLs that appeared verbatim in your search results. Never construct or complete a URL yourself; YouTube playlist links are especially easy to get wrong. If you can't find a real link, leave the list empty.

Output a JSON object in exactly this shape. It will be saved as resources-{{subject}}.json:

{
  "subject": "physics",
  "chapters": [
    {
      "id": "phy-rotational-motion",
      "videos": [ { "title": "...", "url": "https://...", "channel": "...", "language": "hinglish", "duration": "5h" } ],
      "notes": [ { "title": "...", "url": "https://..." } ],
      "ncert_useful": true,
      "books": [ { "name": "HC Verma Vol 1", "section": "Ch 10" } ]
    }
  ],
  "uncertainties": []
}

Use my chapter ids exactly as given.

Output rules:
- Reply with strict, valid JSON in a single ```json code block: no comments, no trailing commas, double quotes only.
- Unknown means null. Never guess a number, date, name or URL. List every gap under "uncertainties".
- If you're about to run out of space, stop at a chapter boundary, close the JSON so it's still valid, and write CONTINUE on its own line after the code block. When I reply "continue", send the next block in the same shape, starting from the next chapter.
```
