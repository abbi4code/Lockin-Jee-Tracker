I'm building a study-tracker app for my younger brother. He's in CBSE Class 12 and preparing for JEE Main 2027 and JEE Advanced 2027 at Vidyamandir Classes (VMC). I need all the research data for the app in ONE JSON file called jee-data.json, which I'll load straight into the app's database. Please do deep research with web search; accuracy matters more than speed.

=====================================================================
HOW TO WORK
=====================================================================

1. Use your file-creation / code tool to build jee-data.json. Work section by section (the order is listed below) and save each section into the file as you finish it. Don't try to write the whole thing in one reply.
2. If you run low on space in a reply, stop after a finished section, say which section comes next, and wait. When I reply "continue", carry on in the same file.
3. When every section is done, load the file with Python (json.load), run the checks at the bottom of this prompt, fix anything that fails, and give me jee-data.json to download.
4. If you can't create files, reply with the JSON in ```json code blocks, one section per block, and follow the same rules.

=====================================================================
RULES FOR ALL DATA
=====================================================================

- Strict, valid JSON: double quotes only, no comments, no trailing commas.
- Unknown means null. Never guess a number, date, name or URL. Every section has an "uncertainties" list, so record gaps and doubts there.
- The official syllabi are the ground truth:
  - JEE Main: the latest NTA syllabus (jeemain.nta.nic.in). NTA revised and cut the syllabus from 2024 onward.
  - JEE Advanced: the latest syllabus on jeeadv.ac.in.
  If the 2027 syllabi aren't out yet, use the most recent official ones and say which year.
- Label numbers and tables with "source_type", which is one of:
  - "official": taken from an official notice or information bulletin.
  - "coaching_analysis": from coaching institutes' or education news sites' analyses.
  - "estimate": your own estimate from other data.
  - "expected": a future date projected from past years' patterns.
  Never present an estimate as official.
- Chapter ids are kebab-case with a subject prefix: "math-", "phy-" or "chem-". Keep them short and stable, because every section references them.
- Only include URLs that appeared verbatim in your search results. Never construct or complete a URL yourself.
- Don't leave placeholder text such as "..." or "https://..." anywhere in the final file.

=====================================================================
ALREADY DONE: THE MATHS CHAPTER MAP
=====================================================================

The Maths chapter list is finished and already in my app. Don't redo it. Use exactly these ids for Maths in the topics, weightage and resources sections, and use them as prerequisites when a Physics or Chemistry chapter depends on Maths (vectors, calculus, trigonometry, logarithms, and so on).

Format: id | name | unit | class | exams

math-sets-relations | Sets and Relations | Algebra | Class 11 | Main+Adv
math-logarithms | Logarithms | Algebra | Class 11 | Adv
math-quadratic-equations | Quadratic Equations | Algebra | Class 11 | Main+Adv
math-complex-numbers | Complex Numbers | Algebra | Class 11 | Main+Adv
math-sequences-series | Sequences and Series | Algebra | Class 11 | Main+Adv
math-permutations-combinations | Permutations and Combinations | Algebra | Class 11 | Main+Adv
math-binomial-theorem | Binomial Theorem | Algebra | Class 11 | Main+Adv
math-matrices | Matrices | Algebra | Class 12 | Main+Adv
math-determinants | Determinants | Algebra | Class 12 | Main+Adv
math-trigonometric-ratios | Trigonometric Ratios and Identities | Trigonometry | Class 11 | Main+Adv
math-trigonometric-equations | Trigonometric Equations | Trigonometry | Class 11 | Adv
math-inverse-trigonometric-functions | Inverse Trigonometric Functions | Trigonometry | Class 12 | Main+Adv
math-functions | Functions | Calculus | Class 12 | Main+Adv
math-limits | Limits | Calculus | Class 11 | Main+Adv
math-continuity-differentiability | Continuity and Differentiability | Calculus | Class 12 | Main+Adv
math-methods-of-differentiation | Methods of Differentiation | Calculus | Class 12 | Main+Adv
math-application-of-derivatives | Application of Derivatives | Calculus | Class 12 | Main+Adv
math-indefinite-integration | Indefinite Integration | Calculus | Class 12 | Main+Adv
math-definite-integration | Definite Integration | Calculus | Class 12 | Main+Adv
math-area-under-curves | Area Under Curves | Calculus | Class 12 | Main+Adv
math-differential-equations | Differential Equations | Calculus | Class 12 | Main+Adv
math-straight-lines | Straight Lines | Coordinate Geometry | Class 11 | Main+Adv
math-circles | Circles | Coordinate Geometry | Class 11 | Main+Adv
math-parabola | Parabola | Coordinate Geometry | Class 11 | Main+Adv
math-ellipse | Ellipse | Coordinate Geometry | Class 11 | Main+Adv
math-hyperbola | Hyperbola | Coordinate Geometry | Class 11 | Main+Adv
math-vector-algebra | Vector Algebra | Vectors and 3D Geometry | Class 12 | Main+Adv
math-3d-geometry | Three Dimensional Geometry | Vectors and 3D Geometry | Class 12 | Main+Adv
math-statistics | Statistics | Statistics and Probability | Class 11 | Main+Adv
math-probability | Probability | Statistics and Probability | Class 11 | Main+Adv
math-conditional-probability | Conditional Probability, Bayes' Theorem and Random Variables | Statistics and Probability | Class 12 | Main+Adv

=====================================================================
SECTIONS, IN THE ORDER TO DO THEM
=====================================================================

Top-level shape of jee-data.json:

{
  "meta": { "generated_on": "2026-09-25", "main_syllabus_year": 2026, "advanced_syllabus_year": 2026 },
  "chapters": { "physics": { }, "chemistry": { } },
  "topics": { "maths": { }, "physics": { }, "chemistry": { } },
  "weightage": { "maths": { }, "physics": { }, "chemistry": { } },
  "exam_facts": { },
  "score_tables": { },
  "resources": { "maths": { }, "physics": { }, "chemistry": { } }
}

---------------------------------------------------------------------
SECTION 1: chapters.physics, then chapters.chemistry
---------------------------------------------------------------------

Every chapter in the subject that appears in JEE Main, JEE Advanced or both. Neither official syllabus lists chapters (only units and topics), so split them the way coaching institutes usually do.

Fields for each chapter:
- id, name
- unit_id: must match an id in that subject's "units" list.
- branch: for Chemistry, one of "physical", "organic" or "inorganic". For Physics, null.
- class: 11 or 12, based on the NCERT book it belongs to.
- ncert_chapter: for example "Class 11 Part 1, Ch 7", or null.
- in_main / in_advanced: check each chapter against both official syllabi. Several chapters were removed from Main in 2024 but are still in Advanced. Don't go from memory.
- vmc_name / vmc_order: VMC's own chapter name and its position in VMC's Class 11 or 12 program, only if you find it publicly. Otherwise null. Don't guess.
- prerequisites: ids of chapters you really need to know first. Use ids from this subject, from your other subject, or from the Maths list above.
- difficulty: 1 (easy) to 5 (very hard), based on how aspirants and teachers commonly describe the chapter.
- ncert_critical: true if the NCERT text itself is especially important (common in Inorganic Chemistry).
- notes: anything notable (for example "removed from Main in 2024"), or null.

Shape of chapters.physics (chemistry is the same):

{
  "syllabus_sources": [
    { "exam": "main", "year": 2026, "url": "<official URL>" },
    { "exam": "advanced", "year": 2026, "url": "<official URL>" }
  ],
  "units": [ { "id": "phy-mechanics", "name": "Mechanics" } ],
  "chapters": [
    {
      "id": "phy-rotational-motion",
      "name": "Rotational Motion",
      "unit_id": "phy-mechanics",
      "branch": null,
      "class": 11,
      "ncert_chapter": "Class 11 Part 1, Ch 6",
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
    { "item": "Communication Systems", "change": "removed from Main in 2024", "source_url": "<URL>" }
  ],
  "uncertainties": []
}

---------------------------------------------------------------------
SECTION 2: topics.maths, topics.physics, topics.chemistry
---------------------------------------------------------------------

For every chapter (the Maths ones above, plus your Physics and Chemistry chapters), list its topics/subtopics as the official syllabi describe them. A chapter can be in both exams while some of its topics are Advanced-only (or Main-only), so flag each topic on its own. Keep topic names under ~60 characters and in the order a teacher would cover them. Aim for 4–12 topics per chapter.

Shape of topics.<subject>:

{
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

---------------------------------------------------------------------
SECTION 3: weightage.maths, weightage.physics, weightage.chemistry
---------------------------------------------------------------------

For every chapter: how many questions it gets in the exam. NTA and the IITs don't publish chapter-wise counts, so this comes from coaching institutes' paper analyses (Allen, Aakash, VMC, FIITJEE, Resonance, PW, Mathongo, etc.). Cross-check at least two sources wherever you can.

Also record questions for chapters that aren't named in the Main syllabus but still get asked in Main papers (for example, Trigonometric Equations and Logarithms). This tells me whether my in_main flags match what's asked in reality. Mention any such chapters under "uncertainties".

- main.by_year: the average number of questions per shift, for each year from 2019 to 2026.
- main.avg_questions_per_shift: an overall average, weighting 2024–2026 more heavily (because of the syllabus cut). Explain how in method_notes.
- advanced.by_year: the total number of questions across Paper 1 + Paper 2, for each year from 2019 to 2026. advanced.avg_questions is the average.
- high_yield: true if the chapter is consistently in the top ~30% by questions in either exam.
- roi: 1–5, meaning marks gained per hour of study, the way coaching teachers usually rank chapters. roi_reason is one line.
- confidence: "high" (two or more sources agree), "medium" (one decent source) or "low" (thin data).

Shape of weightage.<subject>:

{
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
      "sources": ["<URL>", "<URL>"]
    }
  ],
  "method_notes": "",
  "uncertainties": []
}

---------------------------------------------------------------------
SECTION 4: exam_facts
---------------------------------------------------------------------

1. dates: JEE Main 2027 Session 1 and Session 2 (registration, exam window, result), JEE Advanced 2027 (registration, exam, result) and CBSE Class 12 board exams 2027 (theory exam window). "kind" is one of "registration", "exam" or "result". If a date isn't announced, project it from the 2024–2026 pattern and mark it "expected".
2. main_pattern: the JEE Main B.E./B.Tech paper as it applies to 2027 (or the latest year): sections per subject, question types, how many must be attempted, and marks for correct, wrong and unattempted answers. Include changes from the last 3 years.
3. advanced_patterns: the JEE Advanced patterns for 2023, 2024, 2025 and 2026 (the pattern changes every year). For each year, list both papers, and in each paper each subject's sections.
4. eligibility: the Main cutoff to qualify for Advanced (number of candidates, and category-wise percentile cutoffs for 2023–2025), the Class 12 board criterion for IIT/NIT admission, the Advanced attempt limit and the age limit.

Question type is one of: "mcq_single", "mcq_multiple", "numerical_integer", "numerical_decimal", "matching_list", "paragraph", or "other" (explain in notes).

Shape of exam_facts:

{
  "dates": [
    { "event": "JEE Main 2027 Session 1", "kind": "exam", "start": "2027-01-22", "end": "2027-01-31", "source_type": "expected", "source": "<URL or null>" }
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
    "recent_changes": [ { "year": 2025, "change": "" } ],
    "source_type": "official",
    "source": "<URL>"
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
                { "name": "1", "type": "mcq_multiple", "questions": 4, "marks_correct": 4, "marks_wrong": -2, "partial_marking": "describe the rule", "notes": null }
              ]
            }
          ]
        }
      ],
      "source_type": "official",
      "source": "<URL>"
    }
  ],
  "eligibility": {
    "advanced_qualifying": {
      "top_candidates": 250000,
      "percentile_cutoffs": [
        { "year": 2025, "general": null, "ews": null, "obc_ncl": null, "sc": null, "st": null, "pwd": null }
      ],
      "source_type": "official",
      "source": "<URL>"
    },
    "board_criterion": { "general_percent": 75, "sc_st_percent": 65, "alternative": "top 20 percentile of own board", "source_type": "official", "source": "<URL>" },
    "advanced_attempts": { "max_attempts": 2, "rule": "in two consecutive years", "source_type": "official", "source": "<URL>" },
    "age_limit": { "rule": "", "source_type": "official", "source": "<URL>" }
  },
  "uncertainties": []
}

---------------------------------------------------------------------
SECTION 5: score_tables
---------------------------------------------------------------------

The app will estimate percentile and rank from mock scores. Background, so you label the data correctly:
- NTA publishes each candidate's percentile, but not marks-vs-percentile tables. Percentile is normalised per shift, so the same marks give different percentiles in different shifts. Public marks-vs-percentile tables are coaching estimates, based either on one shift or on an average across shifts.
- Percentile-vs-rank and Advanced marks-vs-rank tables are also mostly compiled by coaching sites.
For every table, record source_type, a "basis" (which shift or session it describes, for example "average across all Jan 2025 shifts" or "final combined NTA score") and the source URL.

1. main_marks_vs_percentile: 2023, 2024, 2025 and 2026, per session if the sources split it. "session" is one of "jan", "apr" or "combined". Use bands of about 10–20 marks across 0–300.
2. main_percentile_vs_rank: CRL rank for the same years.
3. advanced_marks_vs_rank: CRL rank for 2023–2026, including that year's max_marks.

Shape of score_tables:

{
  "main_marks_vs_percentile": [
    {
      "year": 2025, "session": "jan", "basis": "average across all Jan 2025 shifts",
      "source_type": "coaching_analysis", "source": "<URL>",
      "bands": [ { "marks_min": 281, "marks_max": 300, "percentile_min": 99.99, "percentile_max": 100 } ]
    }
  ],
  "main_percentile_vs_rank": [
    {
      "year": 2025, "basis": "final combined NTA score",
      "source_type": "coaching_analysis", "source": "<URL>",
      "bands": [ { "percentile_min": 99.9, "percentile_max": 100, "rank_min": 1, "rank_max": 1400 } ]
    }
  ],
  "advanced_marks_vs_rank": [
    {
      "year": 2025, "max_marks": 360, "basis": "CRL",
      "source_type": "coaching_analysis", "source": "<URL>",
      "bands": [ { "marks_min": 300, "marks_max": 360, "rank_min": 1, "rank_max": 100 } ]
    }
  ],
  "uncertainties": []
}

---------------------------------------------------------------------
SECTION 6 (lowest priority): resources.maths, resources.physics, resources.chemistry
---------------------------------------------------------------------

For every chapter:
- videos: 1–2 highly rated free YouTube one-shots or lecture series (for example PW, Unacademy, Mohit Tyagi, Eduniti, Vedantu, Mathongo, or well-known individual teachers), with language ("hindi", "english" or "hinglish") and approximate duration. YouTube playlist links are especially easy to get wrong. Only include links you actually saw in search results, and leave the list empty if you're not sure.
- notes: a free formula sheet or short-notes source, if one exists.
- ncert_useful: whether solving NCERT examples/exercises is worthwhile for this chapter.
- books: standard practice books toppers recommend (for example HC Verma, DC Pandey, Cengage, MS Chauhan, N Awasthi, VK Jaiswal, Black Book), and the relevant chapter or section.

Shape of resources.<subject>:

{
  "chapters": [
    {
      "id": "phy-rotational-motion",
      "videos": [ { "title": "", "url": "<URL>", "channel": "", "language": "hinglish", "duration": "5h" } ],
      "notes": [ { "title": "", "url": "<URL>" } ],
      "ncert_useful": true,
      "books": [ { "name": "HC Verma Vol 1", "section": "Ch 10" } ]
    }
  ],
  "uncertainties": []
}

=====================================================================
CHECKS BEFORE YOU HAND THE FILE OVER
=====================================================================

Run these in Python on the finished file, and fix anything that fails:
1. The file loads with json.load.
2. Physics and Chemistry chapter ids are unique, kebab-case, and start with "phy-" / "chem-". None of them clash with the Maths ids.
3. Every unit_id exists in that subject's units list. Every Chemistry chapter has a branch; every Physics chapter has branch null.
4. Every prerequisite id exists: in the Maths list above, or in chapters.physics / chapters.chemistry. No chapter lists itself.
5. topics, weightage and resources each cover every chapter of their subject (all 31 Maths ids above, plus all your Physics and Chemistry ids), and use no ids that don't exist.
6. Every chapter is in at least one exam (in_main or in_advanced is true). difficulty and roi are whole numbers from 1 to 5, or null.
7. Every source_type is one of "official", "coaching_analysis", "estimate" or "expected".
8. No placeholder text is left: no "...", "<URL>", "https://..." or empty-string values where real content belongs.

Then give me:
- the jee-data.json file to download
- a short summary: chapter counts per subject, which chapters are Main-only or Advanced-only, chapters asked in Main even though the syllabus doesn't name them, the biggest uncertainties, and anything I should verify by hand.
