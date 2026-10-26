# lockin. — project context for a new Claude session

Read this first. It describes what the app is, how every feature works, where the code is, the design system, and the rules and gotchas learned so far. Last written 2026-10-26 from `main` at `f049a79`. When this file and the code disagree, the code wins. Update this file when you change something it describes.

---

## 1. What this is

**lockin.** is an installable PWA that tracks JEE preparation. The owner (repo author, Abhishek, abhishek4code@gmail.com) built it for their younger brother, called **"the student"** below. The student is in Class 12 in 2026–27, takes coaching at **VMC** (Vidyamandir Classes), and is aiming for **JEE Main 2027** (Session 1 on 22 Jan 2027) and **JEE Advanced 2027** (16 May 2027). The student also sits the **NSE olympiads** (NSEA 21 Nov, NSEP and NSEC 22 Nov 2026).

There are two roles:
- **Student**: tracks syllabus, study time, questions solved, tests (MathonGo chapter-wise and Quizrr), the planner, chat with the coach, and a weekly "college game".
- **Admin / coach** (the owner): the `/admin` panel shows every student's data. The coach can log or fix test scores, set Quizrr test dates, import the old Excel tracker, and chat with the student.

The tone is Gen Z and gamified, but calm: streaks, a college ladder, taunting headlines, confetti. The UI/UX is one of the main points of the project. See §6 before you touch any UI.

Deployed on **Vercel**. The backend is **Supabase** (auth, Postgres, Realtime). The GitHub repo is referenced as `abbi4code/Lockin-Jee-Tracker`.

---

## 2. Hard rules and gotchas (read before coding)

1. **This is Next.js 16, not the version in your training data.** Read the relevant guide in `node_modules/next/dist/docs/` before you write Next code (see AGENTS.md). Known differences used here:
   - Middleware is now **`src/proxy.ts`**, which exports `proxy()`.
   - `params` are Promises. Pages use the global `PageProps<"/route">` and `LayoutProps<"/route">` types.
   - Turbopack is the bundler.
2. **`next dev` rewrites AGENTS.md / CLAUDE.md.** Commit that block rather than fighting it.
3. **Migrations are applied by hand.** The owner pastes them into the Supabase SQL editor because the CLI isn't linked. Every migration must be **safe to re-run**: use `if not exists`, `drop policy if exists`, and `create or replace`. The client code also **tolerates a missing migration**:
   - `sync.ts` checks `missingTable` (`PGRST205`/`42P01`) and `missingColumn` (`PGRST204`/`42703`) and falls back.
   - `chat.ts` falls back on `PGRST202` (missing RPC).
   - Admin loaders treat a query error as "feature not available".

   Keep this pattern for any new table.
4. **RLS gotcha:** a policy on table X must never query table X ("infinite recursion detected in policy"). Do that check inside a `security definer` function instead (see `message_in_thread`). This bug once broke every chat send in prod. The fix is `20261012180000_chat_status.sql`.
5. **Admin status lives in two places. Keep them in sync:**
   - the `ADMIN_EMAILS` env var (server routing, `/admin`, `isAdminEmail()` in `src/lib/admin.ts`)
   - the `public.admins` table (DB side: chat RLS via `is_admin()` and `is_admin_user()`)

   `ADMIN_EMAILS` never reaches the browser. The client asks `GET /api/me` instead.
6. **Time zone:** every "day" is an **Indian day**.
   - `src/instrumentation.ts` always sets `process.env.TZ = APP_TZ || "Asia/Kolkata"`, because Vercel pre-sets UTC.
   - Local dates are always `toLocaleDateString("en-CA")`, which gives `YYYY-MM-DD`.
   - Date-only strings are parsed as `` new Date(`${d}T00:00`) `` (local midnight). Never parse them as UTC.
   - Quizrr release times are formatted in `Asia/Kolkata` explicitly.
7. **Colours come only from CSS tokens** (`var(--color-*)` or Tailwind `text-fg`, `bg-ink`, …). Never hard-code hex in components. The exceptions are confetti colours and the theme swatches/boot script.
8. **Chapter ids are stable** (`phy-…`, `chem-…`, `math-…`, kebab-case). User data is keyed by them. Never rename one.
9. **Local-first:** the zustand store in localStorage is the source of truth on the device. Supabase is a sync target. Without the Supabase env vars, the app runs fully in **local-only mode** (no accounts). That mode is also how e2e testing is done.
10. **Don't write synced settings before the first pull on a new device.** It would overwrite the account's real settings with empty ones. `RulesScroll` waits for sync for exactly this reason.
11. The owner applies changes and wants them **tested** (§9). Do git commits and pushes only when asked.

---

## 3. Stack and commands

| | |
|---|---|
| Framework | Next.js 16 App Router (`src/app`). Screens live in `src/screens`, not `src/pages`. |
| UI | React 19, Tailwind CSS 4 via `@tailwindcss/postcss` (tokens in `@theme`, `globals.css`), `motion` (`motion/react`), `lucide-react` icons |
| Fonts | `@fontsource-variable/doto` (dot-matrix numerals), `geist` (sans), `jetbrains-mono` (mono) |
| State | `zustand` with `persist` (key `lockin-v1`, version 2, `skipHydration: true`) |
| Backend | `@supabase/ssr` (browser and server clients), `@supabase/supabase-js` (secret-key admin client), Realtime |
| Push | `web-push` (VAPID), hand-written `public/sw.js` |
| Other | `chess.js`, `canvas-confetti`, `server-only` |
| Tests | `vitest` (node env, `src/**/*.test.ts`, `@` → `src` alias) |
| TS | TypeScript 7, `@/*` → `src/*` |

```
npm run dev        # runs scripts/build-data.mjs, then next dev
npm run build      # build-data, then next build
npm start          # production server (the service worker only registers in production)
npm test           # vitest: 71 tests in 7 files, all passing at f049a79
npm run typecheck  # tsc --noEmit
npm run data       # rebuild src/data/*.json from research/
npm run icons      # scripts/build-icons.mjs (PWA icons)
node research/tools.mjs validate   # validate research JSON
```

**Env** (`.env.example`):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (server only, bypasses RLS)
- `ADMIN_EMAILS`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `CRON_SECRET`
- `ANTHROPIC_API_KEY`: reserved for planned AI features and **unused so far**
- `APP_TZ`: optional

---

## 4. Directory map

```
research/                 Source data (hand- and agent-researched JSON). Never imported by the app directly.
  chapters-*.json topics-*.json weightage-*.json resources-*.json   per subject (physics/chemistry/maths)
  exam-facts.json         exam dates (kind "exam" → countdowns; NSE* have a `time`), patterns, eligibility
  score-tables.json       marks↔percentile↔rank tables
  testseries-mathongo.json  81 MathonGo "tracks" (→ app chapter ids, many-to-one), 444 tests
  excel-snapshot.json     the old Excel tracker (stages + tests done), for the one-time admin import
  colleges-{iit,nit,iiit-bits,gfti,state,private,lowrank}.json   closing ranks for the college ladder
  tests/qrt.json qpt.json qft-11.json qft-12*.json   raw Quizrr exports
  tests/quizrr-map.json   Quizrr chapter name → app chapter ids (+ per-test overrides). The build FAILS on unmapped names.
  tests/quizrr-schedule.json  suggested dates per test (fallback until the admin sets dates)
  evidence/ + apply-main-check.mjs   evidence that flipped Adv-only topics to Main (asked 2+ times in Main 2024–26)
  tools.mjs prompts.md all-in-one-prompt.md continue-prompt.md   research helpers / prompts
scripts/build-data.mjs    research/ → src/data/jee.json, colleges.json, quizrr.json, excel-snapshot.json (all gitignored)
supabase/migrations/      SQL, applied in filename order
public/sw.js              service worker (offline cache + push)
src/
  app/                    routes (thin: mostly `export default () => <XScreen/>`), API routes, admin server pages
  screens/                full-page client components (Home, Chapter, Subject, Focus, Plan, Me, Quizrr, Auth, Landing, Extras, Chess)
  components/             shared UI + feature widgets (see §5), admin/ (charts, tables), chess/
  lib/                    domain logic (mostly pure, unit-tested) + supabase clients + sync
  store/progress.ts       the zustand store (all client state + actions)
  data/index.ts           typed access to jee.json (SUBJECTS, ALL_CHAPTERS, TRACKS, EXAMS, getChapter…)
  data/headlines.json     826 headline lines in 19 moods (committed)
  proxy.ts                auth refresh + routing
  instrumentation.ts      server TZ
files/JEE_Chapter_Tracker (1).xlsx   the original Excel the app replaced
```

### Routes
| Path | Screen / file | Notes |
|---|---|---|
| `/` | `app/page.tsx` + `screens/Landing.tsx` | Public landing page with DotField, countdown, features. Signed-in users are redirected. |
| `/login`, `/signup` | `screens/Auth.tsx` | Email and password. Friendly error mapping, 20 s timeout, `?next=` support. |
| `/auth/callback` | route handler | Email-confirmation code exchange |
| `/today` | `screens/Home.tsx` | The dashboard (§5.1) |
| `/s/[subjectId]` | `screens/Subject.tsx` | Chapter list per unit, filters, search |
| `/c/[chapterId]` | `screens/Chapter.tsx` | Statically generated for every chapter (`dynamicParams = false`) |
| `/focus` | `screens/Focus.tsx` | Pomodoro/stopwatch plus the editable session log |
| `/plan` | `screens/Plan.tsx` | Week planner |
| `/quizrr`, `/quizrr/[series]`, `/quizrr/[series]/[no]` | `screens/Quizrr.tsx` | Three levels: overview, series list, one test |
| `/me` | `screens/Me.tsx` | Profile, theme, text weight, exam scope, coaching, goals, notifications, account, backup |
| `/extras`, `/extras/chess`, `/extras/chess/[gameId]` | `screens/Extras.tsx`, `screens/Chess.tsx` | Hidden section |
| `/admin`, `/admin/u/[userId]/{,study,questions,tests,college,chapters,plan,notes}` | server components | Admins only |
| `/api/me` | GET → `{admin}` | |
| `/api/push` | POST subscribe / DELETE | Writes with the secret key, so a device moves with its account |
| `/api/push/test` | POST | Sends a test push |
| `/api/chat/notify` | POST `{id}` | Pushes a just-sent message to the other side (fresh < 2 min, sender must be the caller) |
| `/api/chat/delivered` | POST | The service worker calls this when a chat push lands; it runs `mark_delivered()` |
| `/api/cron/reminders` | GET with `Bearer CRON_SECRET` | Called every 15 min by Supabase pg_cron + pg_net |
| `/api/call/ice` | GET | ICE servers for calls: public STUN, plus a TURN relay when `TURN_URLS` is set. Signed-in only, so TURN credentials never ship in the page |
| `/api/call/notify` | POST `{call}` | Pushes "<name> is calling" to everyone a call is still ringing (fresh < 60 s). The caller must be in the call. Admins get `/admin`, everyone else `/today` |
| `/api/chess/[id]` | POST an action | The online-chess referee: move / resign / offer-, accept-, decline-draw / claim-abandoned / cancel. Replays the game with chess.js and writes with the secret key. Always returns the current `game`, even on refusal |

---

## 5. Features and how they work

### 5.0 App shell (`components/Shell.tsx`, `app/layout.tsx`, `app/template.tsx`)
- `Providers` rehydrates the zustand store once on mount, then sets `ready` and calls `startSync()`.
  - App pages render only after `ready`, so there is no SSR/localStorage mismatch.
  - "Instant" pages (landing, auth) render in the server HTML.
  - It registers `/sw.js` in production only. In dev it unregisters workers and clears `lockin-*` caches.
- `AppChrome` is hidden on chromeless routes (`/`, auth, `/admin`). It contains:
  - `AppBadge`: the app-icon badge, counting due plan items plus due Quizrr tests.
  - `FocusTimer`: the floating running-timer pill. It also finishes pomodoros on time.
  - `ChatDock`
  - `Nav`
- **Nav** is a floating bottom **pill**. The owner explicitly likes it, so keep it.
  - Tabs: Today, **Plan** (laptops only, `desktopOnly`: `hidden lg:block`), Phy, Chem, Math, Focus, Me. Plan was added on 2026-10-26 at the student's request. The owner kept it off phones because 7 tabs crowd the pill; on phones the planner is reached from Today's "planner →" link.
  - The active tab is a filled pill in the tab's colour, with a `layoutId` slide.
  - On laptops every tab shows its label. On phones only the active one does.
  - A red dot on Today means items are due. A warn dot on Me means a sync error or offline.
  - `/c/*` lights its subject's tab, and `/quizrr*` lights Today.
  - **Secret:** a tiny dim dot at the end of the pill opens `/extras`. Keep it out of menus.
- `template.tsx` fades each navigation in with CSS (`.page-fade`), but not the first load.
- `layout.tsx` inlines `THEME_BOOT`, which applies the saved theme and text weight before first paint.

### 5.1 Today (`screens/Home.tsx`)
On laptops it's a 12-column grid: what to do on the left (7 columns), how it's going on the right (5 columns). Phones get one column. Sections from top to bottom:
- **Header**: `lockin.`, AdminLink (admins only), ThemeSwitcher, Main / Main+Adv segmented switch, and the **Headline** (§5.9).
- **QuizrrStrip**: always visible. It shows today's or a missed test (red) or the next one, and an "all tests" link. It was added because the student couldn't find tests below the rules scroll.
- **RulesScroll**: announcements (§5.10).
- **Left column**:
  - **Countdown** to JEE Main (rolling Doto digits, red seconds), then boards and advanced days, then **Olympiads**: three NSE countdowns, each hidden once its day has passed.
  - **TodayPlan**: Quizrr tests (missed, then today's), overdue plus today's plan items, and "due for revision · not planned" with a "+ today" button.
  - **WeekCollege** (§5.8).
  - **Now**: the current focus chapter, its next topic as a one-tap checkbox, and a focus button.
  - **Syllabus**: a dot bar per subject.
- **Right column**:
  - **TodayLog**: hours and questions against the student's own goals, the streak-day hint, and the **questions counter** (per subject −/+1/+5/+10).
  - **Rhythm**: streak with a 28-day dot strip, and pace (chapters/week actual vs needed).
  - **StudyTime**: a 7-day stacked bar (self-study over coaching), plus a coaching toggle for today.
  - **CollegeHistory**, **Quizrr** series progress, **MathonGo TestSeries** summary (average and the lowest-scoring tracks to retest), and **UpNext** (highest-weightage chapters not started).

### 5.2 Syllabus, subjects, chapters
- Data: 96 chapters and 759 topics. Each chapter has `inMain`/`inAdv` flags, topics have their own flags, and `mainNote`/`mainQs` mark topics outside the syllabus that are still asked in Main. Each chapter also has weightage (`main` = questions per shift, `adv` = questions per year, `mainByYear`, `highYield`, `roi`), resources (videos, notes, books), `prereqs`, `difficulty`, and `ncertCritical`.
- **Exam scope** is `settings.exam`: `"main"` hides Advanced-only chapters and topics everywhere (`chapterInScope`/`topicInScope`). `"advanced"` means Main + Adv and is the default.
- **Stages** (`lib/stages.ts`) come from the old Excel board: `undone → working → ready ("test ready") → testing → weak → mains → adv`.
  - **Studied** means `ready` or later (`isStudied`). Studied chapters count as covered, get `doneAt`, and enter the revision cycle.
  - `normalizeStatus` maps the old `todo/doing/done` values. Store migration v1→v2 runs it.
- **Topic ticking** (`toggleTopic`):
  - Ticking every topic moves an unstudied chapter to `ready` (with confetti).
  - Unticking from `ready` goes back to `working`.
  - The first tick moves `undone` to `working`.
- **Setting a stage** (`setStatus`): reaching a studied stage ticks every topic, and going back to `undone` clears them.
- **Chapter page**:
  - Tags, the 7-stage segmented control (scrolls sideways on phones), and "focus on this".
  - The topic checklist, with tags such as "not in syllabus · asked N× in main".
  - The **MathonGo TestSeriesPanel**, and **NotesBlock** (weak spots checklist plus free notes).
  - A sticky right panel with:
    - **steps** ("done so far": lecture / notes / vmc module / pyqs / ncert)
    - **confidence** (cooked / shaky / okay / solid / goated, 0–4; red when ≤1)
    - the **ScheduleBlock** (one-tap dates)
    - the revisions counter with "revised today"
    - YearDots (Main questions per shift by year)
    - "learn first" prereqs
    - resources in a collapsed `Disclosure`
- **Subject page**: a sticky sidebar (progress, search, filters for each stage, high-yield, 11th, 12th) and chapter rows grouped by unit, with a StatusDot, tags, a test count, and weight.
- **Confetti** (`lib/celebrate.ts`) fires in the subject's colours when a chapter becomes studied, when a pomodoro ends, or when a MathonGo track is finished.

### 5.3 Stats (`lib/stats.ts`)
- `subjectStats`: percent counts topics (a studied chapter counts all of its topics).
- `streak(activity)`: consecutive active days ending today, or yesterday if today has no activity yet. It also returns `atRisk`.
- **Activity** is the list of days with any edit, test, question, or timer start. It feeds the streak.
- `pace`: chapters/week needed to finish 3 weeks before the target exam, vs chapters studied in the last 14 days ÷ 2.
- `revisionsDue`: spaced repetition with gaps of `[3, 7, 21, 45]` days after `doneAt`, then after each revision.
- `freeMarks`: the highest-weight unstarted chapters. `currentFocus`: the most recently touched `working` chapter, otherwise the best free-marks chapter.

### 5.4 Focus timer and study log
- **Timer** state (`store.timer`): `mode` (pomodoro/stopwatch), `target` (25/50/90), `chapterId`, `runningSince`, `banked`, `sessionStart`. Elapsed time is `banked + (now − runningSince)`, so it survives reloads and backgrounding.
- **Pomodoro**:
  - `FocusTimer` in the shell finishes it at its length, even if the app was backgrounded. It never counts more than the length.
  - At the end it plays a chime (`lib/chime.ts`, Web Audio), vibrates, shows a notification, and fires confetti.
  - `finishedListeners` and `lastFinished` let the Focus screen show the toast even when it mounts afterwards.
- **Stopwatch**: counts only when the student presses "stop & log". The UI says so in red while it runs.
- A session logs only if it lasted ≥1 minute, and is capped at 12 h. A stopwatch session over 2 h opens the editor with a "trim it" notice.
- The Focus screen shows a **DotRing** of 60 dots (the pomodoro fills toward its length; the stopwatch fills one dot per second), with a red head dot.
- **SessionLog** (`components/SessionLog.tsx`) covers the last 7 days. The student can add time studied without the timer, or edit or delete a session.
  - It blocks future times and overlaps, including the currently running timer.
  - Sessions carry `source: timer|manual`, `edited`, and `updatedAt`.
  - Deletion is a soft tombstone in `removedSessions` until it has synced.
  - Merge logic is in `lib/sessions.ts` (`mergeSessions`, tested).
  - The admin study tab tags sessions as "added by hand" or "edited".

### 5.5 Coaching (`lib/coaching.ts`)
- `settings.coaching = { plans: [{from, days[], hours}], overrides: {date: bool} }`.
- Changing the plan starts a new plan from today, so past weeks keep their hours. Overrides record a skipped scheduled day or an attended unscheduled one.
- Coaching minutes count as **study time** everywhere: college, streak days, StudyTime, and admin.
- Set it up on /me (weekdays plus hours 2–6). Toggle today's coaching on Today.

### 5.6 Planner (`lib/plan.ts`, `screens/Plan.tsx`, `components/PlanItemRow.tsx`, `ChapterPlan.tsx`)
- A `PlanItem` has `{id, chapterId, date, kind: revision|study|test, doneAt, deleted, updatedAt}` and syncs per row (`plan_items`).
- The week view runs Monday to Sunday, with prev/next and "pick week". On desktop, items can be dragged to another day (`text/plan-item`). Each day has "+" with chapter search, suggesting due revisions first.
- **"Plan my week"** (`autoPlan`):
  - Candidates: revisions due in the next 7 days, then studied chapters with open weak spots or confidence ≤1.
  - Spread over 7 days starting today, at most 2 a day, 1 on coaching days. Already-scheduled chapters are skipped.
  - The action can be undone.
- Ticking a **revision** item also logs a revision on the chapter, and unticking it removes that revision.
- Quizrr tests appear on their days but are moved only by the admin.
- Chapter page **ScheduleBlock** gives one-tap dates: today, tomorrow, in 3 days, weekend, next week, or a date pill.

### 5.7 Tests: MathonGo chapter-wise and Quizrr
**MathonGo** (`lib/tests.ts`, `components/TestSeries.tsx`):
- 81 tracks, each covering one or more app chapters (`tracksForChapter`), with N chapterwise tests plus PYQ tests.
- A `TestResult` has `score`, `maxScore`, and optional `correct`, `wrong`, `unattempted`, `timeMin`. `imported` rows come from the Excel import and have no score.
- The chapter page shows numbered squares per test (filled = done, shaded by score) and an inline editor.
- `lastMaxScore` pre-fills the next test's max. Score tone: red <40 %, muted 40–70 %, full ink ≥70 % (`scoreTone`).

**Quizrr** is MathonGo's test platform (`lib/quizrr.ts`, `screens/Quizrr.tsx`, `components/Quizrr.tsx`):
- Series:
  - **QRT** (12 revision tests, class 11, 90 min) and **QPT** (13 part tests, 3 h) are active.
  - **QFT 11** and **QFT** are listed as "coming soon".
  - That makes 63 tests in total (QRT 12, QPT 13, QFT 11 8, QFT 30).
- `opensAt`: QPT 11/12/13 release 25 Oct, 8 Nov, and 22 Nov at 9:00 IST. Everything else is already out.
- **Dates**:
  - The admin sets them per student (`quizrr_schedule`, read-only for students).
  - When no date is set, the date falls back to `suggested` from `quizrr-schedule.json`.
  - `null` means taken off the schedule (`assignedDate`).
  - The student was told only the coach changes dates.
- `testState`: soon / done / today / overdue / planned / open.
- The student logs total and per-subject marks, Quizrr's percentile and rank, and the correct/wrong/unattempted/time split. Marks can be negative (JEE +4/−1, so the minimum is −¼ of the max). If total is empty and every subject is filled, total = sum.
- **Readiness**: studied chapters out of the chapters the test covers. Syllabus chapters link to the app's chapter pages with stage dots.
- The three page levels exist because the owner found a single page "scattered".

**Both kinds of test count in the college game**:
- They feed the same "tests" pillar, using raw %.
- Correct plus wrong answers count toward that day's questions.
- Saving a test counts as an activity day.

### 5.8 The college game (`lib/college.ts`, `components/College.tsx`). Weekly, and the core motivator.
- **Weekly only**: calendar weeks Monday to Sunday. There is no daily college.
- **Pillars**, each a daily average over the week:
  - **hours/day**: focus sessions plus coaching
  - **questions/day**: the counter plus test questions
  - **tests**: average % over the **28 days** before the week's last counted day
- **BENCHMARKS** are anchors that map each pillar to a "like rank" on a log scale:
  - rank 100 ≈ 12 h, 150 questions, 90 %
  - rank 1 lakh ≈ 6 h, 40 questions, 40 %
  - the bottom is 12 lakh = 0
- The pillars combine in **log space**. Weights are hours .4, questions .3, tests .3. The tests weight scales with the number of tests (full at 3 tests in 4 weeks). With no tests, the weights are hours .55 and questions .45.
- **Streak bonus** multiplies the rank:
  - a **streak day** is ≥ **6 h** including coaching
  - ×0.96 per streak day this week
  - ×0.95 for a full 7/7 finished week
  - ×0.95 per earlier consecutive week with 5+ streak days (up to 4)
- **While a week is running**, today counts only if it lifts the average, so a fresh Monday doesn't sink the week.
- **Rank → college**: `collegeFor(rank)` returns the best college whose closing rank is ≥ the rank. The **LADDER** has 423 college-branches from `research/colleges-*.json`, on one JEE Main CRL scale:
  - IIT Advanced ranks are scaled by a smooth `adv_to_main` factor.
  - BITS and own-exam colleges use estimates (`estimate: true`), clamped inside the real range.
  - The lowrank file uses round-1 closings.
  - There is deliberately **no floor**. The owner wanted an "actual depiction": 4–5 h/day lands around rank 1.7 lakh (private colleges).
- `nextUp`: the extra minutes/day or questions/day needed for the next college ("+15 min a day").
- `collegeReport` returns this week, last week, history (8 weeks), the unlocked collection, and today.
- **Daily goals** on /me (`settings.targets`, default 8 h on coaching days, 10 h on other days, 60 questions) are personal only. They drive progress bars and the headline, **not** the college.
- UI:
  - **WeekCollege**: college name, branch, rank, percentile, a row per pillar, streak dots M–S, and the next-college hint.
  - **CollegeHistory**: past weeks and the collection by type.
  - Admin college tab: the ladder around the current college and a weekly column chart.

### 5.9 Headline (`lib/headlines.ts`, `components/Headline.tsx`, `data/headlines.json`)
- One line under the logo, drawn from **19 moods**: time-of-day taunts when nothing has been studied, warming_up / halfway / target_hit / beast_mode, events (pomodoro_done, questions_logged every 10, test_good/mid/bad, level_up), streak_risk / streak_flex, comeback, late_night, coaching_day, and generic.
- Placeholders are `{name} {hours} {questions} {streak} {college} {score}`. A line whose value is missing or zero is skipped.
- An event line holds for 15 minutes. No line repeats within the last 80 shown (localStorage `lockin-headlines-seen`). The first name is prepended when the line doesn't already contain it.
- **Voice**: Gen Z plus Valorant slang, and taunting when the student slacks. **Off-limits:** death or self-harm, intelligence insults, and family guilt.

### 5.10 Announcements: the "rules scroll" (`components/RulesScroll.tsx`, `lib/announcements.ts`)
- These are messages from the "big bro". Current entries:
  - `quizrr-v1`: how Quizrr tests work, with a CTA to /quizrr.
  - `college-v2`: the rules of the new college game, ending with the owner's quote: "A success without sacrifice is no success at all. This is what makes a boy a man… All the best, champ. — your big bro".
- Each announcement:
  - unrolls the first time it's seen
  - then stays as a rolled capsule that sways, with a red live dot, for `days` (10) from the first view
- The first view is stored in `settings.seen[id]`, which syncs, so the countdown is per account. Whether this device has opened it is a localStorage flag (`lockin-scroll-<id>-opened`).
- `scrollMode`: first / reopen / rolled / gone. It waits for sync before writing `seen` (rule 10).
- To add one, define an `Announcement` object and prepend it to `ANNOUNCEMENTS` (newest first).

### 5.11 Chat (`components/ChatDock.tsx`, `lib/chat.ts`, `lib/chat-actions.ts`, `lib/presence.ts`)
- **Model**: one thread per student, keyed by `messages.student_id`.
  - Students see their own thread and talk to "the coach" (any admin).
  - Admins get an **inbox** (`listThreads` server action) with unread counts.
  - On an admin student page, the dock opens straight into that student's thread.
- **Placement**: `app` sits above the nav on phones. `admin` sits in the corner.
- The dock is a floating button that opens a sheet. On phones, the sheet is sized to `visualViewport` while the keyboard is up (`useKeyboardArea`). The composer text is 16 px, because iOS zooms into smaller inputs.
- **Sending**: optimistic, with the Realtime echo replacing the local copy. A failed message offers retry. After the insert, the sender calls `POST /api/chat/notify` (keepalive) to push to the other side.
- **Replies**: swipe right on phones (56 px threshold, with a buzz) or a button on desktop. `reply_to` is checked by RLS through `message_in_thread`. Tapping a quote jumps to and flashes the original message.
- **Reactions**: long-press (420 ms) or the smiley on desktop opens the picker 👍 ❤️ 😂 🔥 💀 🙏, plus reply and copy. Reactions change only through the `react_to_message` RPC (`reactions` jsonb, one per user).
- **Ticks**: a clock while sending, ✓ sent, ✓✓ delivered, **red** ✓✓ read. Red, not blue, because of the single accent.
  - `delivered_at` is set by `mark_delivered()`, from the recipient's open app (`useUnread`) or from the service worker when the push lands (`/api/chat/delivered`).
  - `mark_read(student)` sets read and delivered together.
- **Presence**: a Realtime presence channel `"online"`, tracked only while the app is visible. "Last seen" is a heartbeat every 60 s in `chat_presence`. Admins see everyone's; a student sees only the coaches'. The header shows typing… (a broadcast, at most every 2 s) / online / last seen.
- Quick replies for the coach: "how's today going?", "logged today's test?", "proud of you 🔥", "take a 10 min break".
- A notification tap opens `?chat=1`, which opens the dock and then drops the flag from the URL.
- `NotifyPrompt` inside the chat asks to enable push, and can be dismissed (`lockin-chat-notify-dismissed`).

### 5.12 Push notifications and reminders
- One push subscription per device (`push_subscriptions`, keyed by endpoint) covers **both chat and reminders**. The /me section is called "notifications" (`RemindersSection`).
- `lib/push-client.ts`:
  - enable, disable, and test
  - needs the production service worker and the VAPID public key
  - on iPhone, the app must be installed to the home screen first
- `lib/push-server.ts` `sendToUser` sends to every device of a user and deletes subscriptions that return 404/410.
- **Reminders** (`lib/reminders.ts`):
  - `settings.reminders = {morning, evening, tz}` with half-hour options (morning 04–12, evening 16–23).
  - The trigger is a Supabase **pg_cron** job every 15 min that calls `net.http_get` on `/api/cron/reminders` with `CRON_SECRET`. Vercel's free cron is daily only. The SQL is at the bottom of the plan_reminders migration.
  - A reminder fires if its time passed less than 60 min ago in the user's TZ.
  - **Idempotent**: the run first inserts a `(user, day, slot)` row into `reminder_log`; if the insert fails, another run already sent it.
  - Morning content: today's plan, else overdue items, else due revisions. Evening: only if planned items are still open.
- The service worker shows the notification. `notificationclick` focuses or opens the app on `data.url`.

### 5.13 PWA / offline (`public/sw.js`, `app/manifest.ts`)
- The cache is `lockin-v4`. **Bump it whenever the caching rules change.** It pre-caches the shell (`/`, `/today`, the quizrr pages, the manifest, the icon).
- Fetch rules:
  - `/_next/static` is cache-first, and only stores responses marked immutable.
  - Navigations and RSC requests are network-first, falling back to the cache after 3 s or when offline (else `/today`).
  - Everything else is stale-while-revalidate.
  - `/api`, `/auth`, `/admin`, and cross-origin requests are never cached.
- `next.config.ts` serves `/sw.js` as no-store and adds security headers.
- Manifest: standalone, portrait, black. Shortcuts: Focus and Today. Icons are built by `scripts/build-icons.mjs`.

### 5.14 Extras / chess (`/extras`, `screens/Chess.tsx`, `lib/chess/*`)
- The hidden section is reached only through the nav's end dot. It reads "you found it". More extras are planned.
- **Chess**:
  - Modes: `two` (two players on one screen, the main mode per the owner) and `cpu`, with easy / medium / hard.
  - **Online** play: `/extras/chess/<uuid>`. White creates the game and shares the link, and the first other user to open it joins as black (`join_chess_game` RPC, open `waiting` games only). The row holds the PGN, and each client replays it with chess.js.
    - **The server referees** (since `chess_server` migration): players can only insert an empty game and join; they have no update rights. Every action goes through `POST /api/chess/[id]`, which runs `decide()` in `lib/chess/rules.ts` (legal move, your turn, matching `ply`; results are computed server-side, never sent by the client). The write is guarded on `ply`, `status` and `updated_at`, and on a clash the route re-reads and decides again (up to 3 times).
    - The client plays a move locally first; if the server refuses it or can't be reached, `useOnlineGame().act` puts the board back to the last saved game and shows `notice` in red.
    - **Draw offers** (`draw_offer` = side offering; any move clears it), **abandonment** (`moved_at`: after `ABANDON_MS` = 3 days silent on their move, the other side may claim the win), and **cancelling** an open game (white only; `reason = 'cancelled'`, `result` null; hidden from "your online games").
    - Tolerates a missing migration: the route retries without the new columns, and the draw button hides while `draw_offer` is absent from the row. There are deliberately **no clocks** (casual correspondence-style games).
  - The engine (`lib/chess/engine.ts`) is its own 10×12 mailbox move generator (~50× faster than chess.js), with alpha-beta, quiescence, and iterative deepening against a time limit. It runs in a **web worker**.
  - **Turbopack needs the literal form** `new Worker(new URL("…", import.meta.url), { type: "module" })`, or it ships raw `.ts`.
  - The computer takes at least 400 ms to answer. Takeback is supported. The client sends the game's earlier positions (`history`, FENs) so the engine sees repetitions, and it knows the 50-move rule.
  - If the worker errors or doesn't answer within 15 s, it's terminated and the player gets "let it try again" instead of an endless "thinking".
  - Captured pieces come from the move history (`lib/chess/display.ts`), so promoted pawns aren't shown as captured.
  - Boards: `app` (follows the theme), `wood`, `green`. Piece sets: `dots` (dot-matrix, the default), `classic` (cburnett), `letters`. Black pieces use the accent red in dots and letters.
  - Full-screen mode is toggled with `f` or Esc. State is saved in localStorage `lockin-chess`.

### 5.15 Admin panel (`src/app/admin/**`, `lib/admin-data.ts`, `lib/admin-student.ts`, `components/admin/*`)
- Server components read with the **secret key** (`createSupabaseAdmin`). Guards run in three layers: the proxy, then `requireAdmin()` in each page, then each server action.
- Admins are excluded from student lists (`isAdminEmail`).
- When an admin logs in, the proxy sends them to `/admin`. Students go to `/today`. Admins can still open every app page, and Today shows them an "admin" pill.
- **`/admin`** shows stats (students, active today, total study this week) and a searchable `StudentList` (last active, streak, 7-day study, questions, tests, college, syllabus).
- **`/admin/u/[id]`** is a layout with a header, `StudentTabs` (`layoutId` underline), and `loadStudent` (React `cache`, shared by the layout and the tab page). Tabs:
  - **overview**: tiles and "attention" (overdue plan items, open weak spots, shaky chapters, inactive days, revisions due)
  - **study**: 30-day chart, by subject and chapter, last 25 sessions with tags
  - **questions**
  - **tests**: MathonGo log/fix/delete, the one-time Excel import, and **QuizrrAdmin** for dates and scores
  - **college**
  - **chapters**
  - **plan**
  - **notes**
- Server actions are in `app/admin/actions.ts`: `adminSaveTest`, `adminDeleteTest`, `adminImportExcel` (idempotent, merges stages, skips test numbers already logged), `adminSaveQuizrrDates` (writes only changed dates; empty = unscheduled), `adminResetQuizrrDates`, `adminSaveQuizrr`, `adminDeleteQuizrr`. Each ends with `revalidatePath(..., "layout")`.
- **Charts** (`components/admin/Charts.tsx`) are dependency-free and use token colours. Every chart has a **hover readout line in words**, so nothing depends on colour or hover alone. Bars are capped at 24 px with 4 px rounded tops, and there's an optional labelled reference hairline. `ScoreLine` draws a 2 px line with ringed dots and 40/70 % guides. Averages use `windowDays` (days since joining, capped).
- Admin layout `AdminShell`: `lockin.` plus a red mono title, a "back" link, and the ChatDock in the corner.

### 5.16 Auth and routing (`src/proxy.ts`)
- Refreshes the Supabase session cookie with `getClaims()`. Don't put code between creating the client and that call.
- Signed-out users on a non-public path go to `/login?next=…`. Signed-in users on `/`, `/login`, or `/signup` go to `/admin` or `/today`. Non-admins on `/admin*` go to `/today`.
- Public paths: `/`, the auth pages, `/auth/*`, `/api/cron/*`. The matcher skips static assets, `sw.js`, and the manifest.
- Without the Supabase env vars, the proxy is a no-op (local-only mode).
- The signup name goes into `user_metadata.name` and `settings.name`. After auth, a full navigation lets the proxy see the cookie.
- `signOut()` pushes pending changes first, then resets the local store. `claimDevice` resets local data when a different account signs in on the device.

### 5.17 Calls: video and voice anywhere in the app (`lib/call/*`, `components/call/*`)
- **Global**, not tied to a page: `CallProvider` is mounted once in `Providers` (around every route, `/admin` included), so a call keeps going while you navigate. The call shows in one floating `CallWindow`; rings arrive as an `IncomingCall` banner (chime + buzz every 4 s) on any page, and as a push notification (`/api/call/notify`) when the app is closed.
- **Entry points** (`CallButton`, which shows "in call" for its own context and brings the window back):
  - chat header (`ChatDock`): student ↔ coach, context `coach:<studentId>` from both sides
  - online chess sidebar: context `chess:<gameId>`, the opponent
  - skribbl room header: context `skribbl:<roomId>`, everyone active in the room
- **The database decides who may call whom** (`20261026180000_calls.sql`). Tables `calls` (`key` names the signaling channel; `context`; `ended_at`) and `call_members` (`state` ringing/joined/left/declined/missed, `seen_at` heartbeat). Members-only RLS via the security definer `call_member()`; no direct writes. All writes go through security definer RPCs:
  - `start_call(context, invitees, names, myName)`: checks the relationship (a student may only use their own `coach:<id>` and rings every admin; an admin rings exactly that student; chess only the opponent; skribbl only non-kicked room members), max 8 people, and **reuses** the live call of the same context (an advisory lock makes two people calling each other land in one call). A stale call (nobody's heartbeat for 90 s) is ended and replaced.
  - `set_call_state(call, joined|left|declined)`: the last person leaving ends the call and turns rings into "missed".
  - `call_heartbeat(call)`: every 30 s while in a call.
- **Media is peer to peer** (WebRTC, DTLS-SRTP encrypted). A call is a **mesh**: each pair of devices has one `PeerLink` (`lib/call/peer.ts`); `Mesh` (`lib/call/mesh.ts`) routes signaling by session id (`sid`, one per page load). Signaling runs over a Realtime broadcast channel `call:<id>:<key>`; the key is readable only by members, so nobody can join or inject into a call's channel. It's a regular (public) channel on purpose: private channels would need the project's "Allow public access" turned off, which breaks the app's other channels.
  - Joining broadcasts `hello`; everyone answers with a `hello` addressed to the newcomer, so each pair meets exactly once. A new session of someone already connected replaces the old link (reloads).
  - **Negotiation rule:** only the impolite side (larger sid) opens with an offer; the polite side adds its media when it answers. If both offered, Chromium sometimes never gathers candidates after the polite side's rollback and the call sticks on "connecting". Don't "simplify" this back to both sides adding tracks.
  - Video bandwidth per copy shrinks with the group (`videoBudget`: 1.2 Mbps 1:1, 600 kbps up to 4, 300 kbps beyond); `setParameters` calls are serialized per link (overlapping ones fail).
  - A link that stays down 20 s, **or never comes up within 20 s** (a lost handshake message), is dropped, and the mesh announces itself again so the pair can start over (a network blip or a sleeping laptop heals by itself). It also re-announces when the Realtime channel reconnects.
  - **Roster gating:** channel messages carry a self-declared user id, so a mesh only connects to users the roster has `joined` (`admits`), and a new session can't replace someone's *live* connection (no take-overs by claiming their id). A reload is fine: the old link is down. A newcomer turned away that way is connected as soon as the old session's link closes.
  - **Your other tab/device:** a `hello` from another session of *your own* user means the call moved there: this session steps aside (`notice: "moved"`), leaving the shared roster row alone.
  - `CallSession.reconcile` compares the roster with the connections every 5 s and on every roster change, and re-announces (rate-limited) when someone in the call has no link to us.
- **Lifecycle** (`CallSession`, `lib/call/session.ts`, Supabase-free behind `CallBackend`; `lib/call/backend.ts` is the Supabase side): an unanswered call gives up after 60 s ("didn't pick up"); everyone declining ends it; the last other person leaving ends it ("call ended."). Ending releases the camera and mic.
  - **Hanging up mid-setup** (camera prompt open, `start_call` or `set_call_state` in flight) is safe: every async step re-checks a `turn` counter, stops a freshly opened camera, and marks you `left` again if the database already had you in.
  - **Reloads:** `pagehide` sends a `bye` marked `away` and a keepalive "left" request. The others hold the call for **20 s** (`AWAY_GRACE_MS`, tile shows "connecting…"); the reloaded tab remembers the call (sessionStorage `lockin-call-dropped`) and offers "your call is still going · rejoin" (a tap is needed: browsers block audio autoplay after a reload). A plain hang-up `bye` ends things at once; a roster change that arrives before its `bye` waits 1.5 s for it (each departure gets its own wait).
  - The "your call is still going" banner is offered from the tab's own memory (a reload), or for a crashed device: a `joined` row whose heartbeat is older than one interval + 15 s (a fresher one means another tab/device of yours is in the call, so it isn't offered there).
- **Key access:** only members who are `ringing` or `joined` (and still allowed: `call_allowed(context, user)`, the one relationship check `start_call` and `set_call_state('joined')` share) can read a call's row and key. A former member can't; a kicked skribbl player or demoted admin can't rejoin. Known gap: someone removed while already in a call has seen the key (no key rotation); roster gating keeps them from being connected to.
- **UI:** the window snaps to the corner nearest its middle where you drop it, gliding there from the drop point (localStorage `lockin-call-corner`). While the chat sheet is open it keeps out of the way (left side on a laptop; a folded pill at the top on a phone), via the tiny shared store `lib/overlay.ts` (`setChatOpen` / `useChatOpen`), has small/large sizes and folds into a pill. Voices play through separate `<audio>` elements, so folding never cuts anyone off; all `<video>`s are muted. One other person fills the window with you in the corner; groups get a grid. Mic/camera off shows on everyone's tile. z-index 80 (window) / 90 (banner): above chess full screen (60) and the chat sheet (61).
- **TURN:** STUN alone fails on some strict networks (college/office Wi-Fi, a few carriers). Set `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` to add a relay.

---

## 6. Design system (one of the project's main points)

### 6.1 Philosophy (the owner's decisions; follow them)
- **Nothing-phone style**:
  - pure black by default
  - **hairline sections instead of boxes or cards**
  - **Doto dot-matrix numerals**
  - **a single red accent**
  - **dot-row progress bars**
  - calm motion
  - lots of negative space
- The owner **rejected** the earlier glowing bento-grid and glassmorphism look as generic and distracting.
- The owner **rejected** a skeuomorphic parchment-and-wood scroll as "old fashion, doesn't match our cool UI". **Even a themed or retro metaphor must be rendered in the app's own language**: hairlines, dot rows, Doto digits, red accent, Geist / JetBrains Mono, and tokens. No literal textures and no serif fonts.
- **Desktop must use the full width.** Use `max-w-[1500px]` with multi-column layouts per page (12-column grids, sticky side panels). The owner called out wasted side space. The owner builds mostly for desktop web, with phone second, but both must work well.
- **Readable sizes.** Small text was hard to read, so sizes were bumped by about 1 px. **Don't go smaller** than the current scale: mono labels 11.5–12.5 px, body 14.5–16 px.
- **Themes**: `night` (default, `#000`), `paper` (warm light yellow `#f5eedb`), `sepia` (`#eadcb6`). The owner **dislikes pure white**. Every colour comes from tokens, so themes just work.
- Resources and other distractions stay **collapsed** (`Disclosure`).
- UI copy is **lowercase**, short, plain, and a little cheeky ("this page doesn't exist. unlike your backlog."). Labels are mono, uppercase, and letter-spaced. Headings use sentence case.

### 6.2 Tokens (`src/app/globals.css`, Tailwind 4 `@theme`)
| Token | Night | Use |
|---|---|---|
| `ink`, `ink-2`, `ink-3` | `#000`, `#0b0b0b`, `#141414` | backgrounds, hover rows (`hover:bg-ink-2`), raised sheets |
| `line`, `line-2` | `#1d1d1d`, `#2c2c2c` | hairlines (`border-t border-line`); pill and button borders (`border-line-2`) |
| `fg` | `#ececec` | primary text; **solid primary buttons** (`bg-fg text-ink`) |
| `mute`, `dim` | `#8c8c8c`, `#4d4d4d` | secondary and tertiary text |
| `red` | `#ff3b30` | **the only accent**: seconds digit, live dots, danger, "due/missed", weak, read ticks, selection |
| `dot-off` | `#262626` | unlit dots in bars, rings, strips |
| `phy`, `chem`, `math` | `#8f7cff`, `#b8f34c`, `#ff7a45` | subject colours, **only** for the nav pill and tiny 1.5–2 px marker dots. Never for text. |
| `hot` | `#ff3fa4` | legacy (v1); avoid |
| `sq-*`, `board-*` | | chess boards |

`paper` and `sepia` redefine every token under `html[data-theme=…]`. **Text weight** (`html[data-weight=medium|bold]`) shifts all of Tailwind's `--font-weight-*` up a step. It's set on /me.

Fonts:
- `font-sans` is Geist.
- `font-mono` is JetBrains Mono, used for labels, meta, numbers in rows, and buttons in pills.
- The `.dot` class is Doto 800, tabular, for **digits only**.
- `DotText` splits a string so digits render in Doto and units or punctuation (`: . % h m`) render small in sans at 60 % opacity. Use it for any stat.

### 6.3 Primitives (`components/ui.tsx`, `Controls.tsx`, `Numbers.tsx`)
- **`Page`** (Shell.tsx) is the page wrapper:
  - `max-w-2xl px-5` on phones, `lg:max-w-[1500px] lg:px-12 xl:px-16`
  - safe-area top padding, `pb-36` to clear the nav
  - staggers children with `fadeUp`
- **`Section`**: `border-t border-line pt-4 pb-7` with a `Label` on the left and optional mono `right` text. This is the basic building block. **No cards.**
- **`Label`**: `font-mono text-[11.5px] tracking-[0.16em] uppercase text-mute`.
- **`DotBar`**: a row of dots filled in proportion to the value. `dots="auto"` fits the width (ResizeObserver). The fill sweeps left to right with a staggered delay. Colour changes go through CSS so theme switches are instant. It has `role="meter"`.
- **`StatusDot`**: the stage glyph. Hollow = undone, half = working/test, solid = ready/mains, solid red = weak, and adv adds an outer ring. Working uses a red ring.
- **`Tag`**: a tiny mono uppercase bordered chip, in tones mute / red / fg.
- **`Disclosure`**: collapsed by default, with a rotating chevron and height animation.
- **`Segmented`**: a rounded-full bordered group where the active option is a **white pill** (`bg-fg text-ink`) sliding via `layoutId`. Used for exam scope, mode, stages, and settings.
- **`Check`**: an 18 px square checkbox that fills white when checked, with a tick that draws itself (`pathLength`) and a buzz.
- **`buzz(ms)`**: `navigator.vibrate` haptics on taps. Use it on meaningful taps.
- **`Rolling`** / `useCountdown`: digits roll vertically with a blur (countdowns). **`CountUp`** animates numbers.
- Pill buttons follow these patterns:
  - secondary: `rounded-full border border-line-2 px-3.5 py-1.5 font-mono text-[12px] text-mute hover:border-fg hover:text-fg`
  - primary: `rounded-full bg-fg text-ink px-6 py-3.5 text-[15px] font-medium`
  - toggled on: `border-fg bg-fg text-ink`
- Rows: `-mx-2 rounded-lg px-2 py-2.5 hover:bg-ink-2`, with a subject dot, a truncating name, and right-aligned mono meta.
- Charts in the app are minimal motion bars (`rounded-sm bg-fg`, with a `bg-dim` stacked part for coaching), plus mono `text-[10px]` weekday initials.

### 6.4 Motion
- `fadeUp`: opacity 0→1 with a 4 px rise, 0.28 s, ease `[0.2, 0.8, 0.2, 1]`, **no blur**. Sections stagger 0.04 s.
- `layoutId` slides for the nav pill, segmented pills, filter underline, tab underline, and theme ring. Springs run at stiffness ~400–500 and damping ~30–40.
- `whileTap={{ scale: 0.85–0.95 }}` on buttons. `AnimatePresence` for toasts and inline editors.
- `MotionConfig reducedMotion="user"` plus a global CSS reduced-motion kill switch. Confetti and the DotField respect it.
- The page transition is a 0.2 s CSS fade (not JS), so it doesn't block first paint.

### 6.5 Signature pieces
- **Cursor** (`components/Cursor.tsx`): pointer devices only. A dot follows the pointer exactly and a dotted ring trails it. The ring changes shape by target:
  - pointer: ring
  - **`data-cursor="go"`**: ring plus a red dot (primary actions)
  - **`danger`**: everything red
  - `check`: dotted square
  - `text`: caret
  - `disabled`: slashed ring

  The cursor inverts over solid `fg` fills. Add `data-cursor="go"` to primary CTAs and `data-cursor="danger"` to destructive ones.
- **DotField** (`components/DotField.tsx`): a canvas dot-matrix backdrop with a diagonal light wave and twinkles. It's tuned to stay cheap: offscreen base grid, 30 fps cap, starts when idle, pauses when hidden. Used on landing and auth.
- **DotRing** focus dial, **YearDots** weightage chart, the streak dot strip, and **StreakDots** M–S.
- **Rules scroll** in the app's own language: a hairline capsule roller whose dots light up left to right, plus sway, a light sweep, and a red live dot.
- Dot-matrix chess pieces on a 7×7 grid.

### 6.6 Layout patterns
- Laptops get a 12-column grid: Home 7/5, Chapter 7 + sticky 5, Subject sticky 4 + 8 (xl: chapter rows in 2 columns), Focus 6/6 with a sticky timer, Me 2 columns, Plan 7 day-columns.
- Phones get one column. Sideways scroll with `.no-scrollbar` for the stage selector, filters, and admin tabs. Sticky search/filter bar with `bg-ink/90 backdrop-blur-xl`.
- Fixed bottom nav pill: `bg-ink-2/85 backdrop-blur-xl`, a soft shadow, and `pointer-events-none` on the strip so content under it stays clickable.
- Safe areas: `env(safe-area-inset-*)`. Use `min-h-dvh`. Inputs are ≥16 px on phones (iOS zoom).

### 6.7 Accessibility conventions
- Use `aria-label` on icon buttons, `role="checkbox"`/`aria-checked`, `role="meter"`, and `aria-live` on the headline.
- Don't use colour alone. Subject identity comes from the label and position, and the subject dot only supplements it, because the subject colours aren't colour-blind safe as a pair. Admin charts repeat values in words.

### 6.8 Checklist for new UI
1. Use `Page` and `Section` (hairlines, no boxes), with `Label` for headings.
2. Numbers go in `DotText` or `.dot`. Progress uses `DotBar`.
3. Colours come only from tokens. Use red only for "act now / live / bad / danger".
4. Lay out for laptop with a 12-column grid, plus a sensible phone column. Check paper and sepia.
5. Use `fadeUp` variants, `buzz()` on taps, and `data-cursor` hints on CTAs.
6. Copy is lowercase and short. Sizes are no smaller than the existing scale.

---

## 7. Client state, sync, and the database

### 7.1 Store (`src/store/progress.ts`)
State:
- `chapters`: `{[chapterId]: ChapterProgress}` with status, topics, steps, revisions, confidence, doneAt, updatedAt, notes, and weak[]
- `settings`: name, exam, coaching, targets, reminders, seen
- `activity`: days
- `stateUpdatedAt`
- `questions`: `{[day]: {physics, chemistry, maths, at}}`
- `sessions`, `removedSessions`
- `timer`
- `tests`, `lastMaxScore`
- `plan`
- `quizrr`, `quizrrDates` (read-only, replaced by sync)
- `owner`: the Supabase user id the local data belongs to
- **`dirty`**: a list of sync keys: `<chapterId>`, `"state"`, `session:<id>`, `test:<id>`, `plan:<id>`, `quizrr:<id>`

Every user action stamps `updatedAt = Date.now()`, adds today to `activity` (via `edit()` / `withActivity`), and marks the item dirty.

### 7.2 Sync (`src/lib/sync.ts`), local-first
- `startSync()` runs a **full sync** (pull, then push) on sign-in, when the app becomes visible, and when the device comes back online. Any dirty change schedules a **push** 1.5 s later.
- Conflict rules:
  - **Chapters, tests, plan, quizrr, sessions**: the newest `updatedAt` wins, per row.
  - **Activity**: the union of both sides.
  - **Questions**: per day, the newer `at` wins.
  - **Settings**: the newer `stateUpdatedAt` wins as a whole.
  - **quizrrDates**: the server copy replaces the local one.
- Sessions are pulled only for the last 120 days.
- **Soft deletes** (`deleted = true`) are used everywhere so removals reach every device.
- `markClean(ids, syncedAt)` keeps an id dirty if it changed again while its upload was in flight.
- `SyncState`: off / signed-out / syncing / synced / offline / error. It's shown on /me and as a dot on the Me tab.

### 7.3 Tables (all with RLS; owners see their own rows; the admin panel bypasses RLS with the secret key)
| Table | Key / notes |
|---|---|
| `chapter_progress` | (user_id, chapter_id), `data` jsonb = ChapterProgress |
| `user_state` | user_id, `data` = {settings, activity, questions, updatedAt} |
| `study_sessions` | id. Has updated_at, deleted, source, edited (session_edits migration). `minutes ≤ 720` (constraint added `not valid`). |
| `test_results` | MathonGo. Soft delete, `imported` flag. |
| `plan_items` | soft delete |
| `push_subscriptions` | endpoint PK |
| `reminder_log` | (user, day, slot). No policies, so it's server only. |
| `admins` | email. `is_admin()` and `is_admin_user(uid)` are security definer. |
| `messages` | student_id thread, sender_id, body (1–4000), chapter_id, reply_to, reactions jsonb, read_at, delivered_at. Column-level grants: insert only the basic columns, update only `read_at`. In the Realtime publication. |
| `chat_presence` | last_seen |
| `chess_games` | PGN, ply, status, result, reason, draw_offer, moved_at. Players may insert an empty game and select their own; **no update grants** (the `/api/chess/[id]` route writes with the secret key). In the Realtime publication. |
| `quizrr_attempts` | soft delete. percentile 0–100, rank > 0 checks. |
| `quizrr_schedule` | (user, test) → date/null. Students can **only select**; the admin writes with the secret key. |

RPCs: `react_to_message`, `mark_delivered`, `mark_read(student)`, `message_in_thread`, `join_chess_game`. Execute is revoked from `public`/`anon` and granted to `authenticated`.

| `calls` | id, `key` (names the signaling channel), created_by, `context`, ended_at. Members-only select; no direct writes. In the Realtime publication. |
| `call_members` | (call, user_id), name, `state`, invited_by, `seen_at`. Members-only select; no direct writes (RPCs `start_call`, `set_call_state`, `call_heartbeat`). In the Realtime publication. |

Migrations, in order: `init` → `test_results` → `chat` → `chess` → `plan_reminders` → `chat_reactions` → `session_edits` → `chat_status` (also fixes the recursion bug) → `quizrr` → `chess_server` → `skribbl` → `calls`.

**Applying them:** the project is now linked (`supabase link --project-ref habfudmxxcpoalwjbcgl`). The remote migration history was empty because everything up to `quizrr` was pasted into the SQL editor by hand; mark those as applied once (`supabase migration repair --status applied <the 9 versions>`) and `supabase db push` then applies only the new ones.

### 7.4 localStorage keys
| Key | Holds |
|---|---|
| `lockin-v1` | the store |
| `lockin-theme`, `lockin-weight` | appearance |
| `lockin-headlines-seen` | recent headline lines |
| `lockin-chess` | chess game and look |
| `lockin-scroll-<id>-opened` | whether this device opened an announcement |
| `lockin-chat-notify-dismissed` | the chat's push prompt was dismissed |
| `lockin-call-corner` | which corner the call window sits in |
| `lockin-call-dropped` (sessionStorage) | the call this tab was in when it closed or reloaded, for "rejoin" |

Wrap localStorage access in try/catch, because private mode can throw.

---

## 8. Data pipeline

`scripts/build-data.mjs` runs before dev and build. It writes these outputs (all gitignored except `colleges.json`, which is committed):
- **`src/data/jee.json`**: subjects → units → chapters (merged from chapters, topics, weightage, and resources; YouTube ids extracted), `exams` (from `exam-facts.json` entries with `kind: "exam"`), and MathonGo `tracks`.
- **`src/data/colleges.json`**: the ladder (§5.8). IIT ranks are converted with a smooth Adv→Main factor; estimates are clamped; ids are de-duplicated (the first file wins); `iiitb-cse/ece` are skipped; sorted by rank.
- **`src/data/quizrr.json`**: series and tests, with syllabus parsed from Quizrr's HTML (two formats) and mapped through `quizrr-map.json` (overrides per test). It **throws** on unknown names, unknown ids, a schedule entry for an unknown test, or a scheduled date before the test opens.
- **`src/data/excel-snapshot.json`**: for the admin import.

`src/data/headlines.json` is committed (not built). To add a countdown, add an entry with `kind: "exam"` (and an optional `time`) to `research/exam-facts.json`. Home finds exams by regex on `event` (e.g. `/Main 2027 Session 1$/`, `/^NSE/`).

Research workflow: from 2026-10-01, the owner prefers Claude Code to research directly (with parallel agents) and write JSON into `research/`, then run `node research/tools.mjs validate`. Previously they copy-pasted prompts into browser Claude. The official syllabus sources are the NTA JEE Main 2026 PDF and the JEE Advanced 2026 brochure (jeeadv.ac.in, IBEnglish_2026.pdf, ~pp. 63–78). The literal NTA syllabus undercounts what Main actually asks, hence the evidence-based `in_main` flips.

---

## 9. Testing

- Unit tests (vitest, node) live next to the code: `college`, `quizrr`, `sessions`, `sync`, `presence`, `announcements`, `store/progress`, `chess/engine` (perft + draw awareness), `chess/rules`, `chess/display`, `call/calls`, `call/session` (fake backend, fake timers, stand-in peer connection), and the routes `app/api/chess/[id]` and `app/api/call/notify` (mocked Supabase clients). Pure logic belongs in `src/lib` and should be tested.
- **E2E approach that worked**: Playwright from the **scratchpad** (not the repo) against `next dev` with **blank Supabase env vars** (local-only mode), seeding store and timer state in localStorage under `lockin-v1`. **Don't fast-forward the Playwright clock**, because it stalls motion's exit animations.
- **SQL**: test migrations and policies with **PGlite** in the scratchpad. Stub the `auth` schema (`auth.uid()`, `auth.jwt()`, `auth.users`), run every migration in order, and act as roles via `set role authenticated` plus `request.jwt.claims`.
- **Calls (real WebRTC)**: Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`. Two layers:
  - bundle `lib/call/mesh.ts` with esbuild and run groups of 2–4 pages over a BroadcastChannel signal, with 0/5/25/60 ms latency (0 ms is the one that finds races): media flowing in every pair, simultaneous joins, leave, reload, crash.
  - the real UI: a test-only layout in a **scratchpad copy** of the app that mounts `CallRoot` over a localStorage "database" (shared by every tab; `storage` events stand in for Realtime). `CallRoot` takes any `CallBackend` for exactly this. Covers ring → join, navigation, folding, mute/camera, corner drag, 3-way, reload → rejoin, hang-ups, decline, camera release.
- Next 16 allows **one `next dev` per project folder**: to run a second (local-only) server while the owner's is up, copy the tree to the scratchpad without `.env*` and clone `node_modules` with `cp -cR` (Turbopack rejects a symlinked `node_modules`).
- Push and the service worker only work in a production build (`npm run build && npm start`).

---

## 10. Code conventions

- Comments explain **why**, in plain sentences. There's a `/** … */` doc on most exports. Match the density: concise, no fluff.
- Naming is short and domain-specific (`pending`, `overdue`, `dueQuizrr`, `withPlan`). Days are `YYYY-MM-DD` strings and times are ISO. `updatedAt` is ms.
- Row mappers `toXRow` / `fromXRow` convert app shape ↔ PostgREST (numeric columns arrive as strings).
- Server-only modules `import "server-only"`. Server actions use `"use server"` and re-check `requireAdmin()`.
- Pages in `src/app` stay thin. The UI lives in `src/screens` and `src/components`, and logic lives in `src/lib`.
- Prefer graceful degradation (missing table or env) over hard failures.
- Copy talks to the student in second person, lowercase.

---

## 11. Known gaps and loose ends

- **VMC chapter names and order are not in the data** (the `vmc_*` fields are null). The project is waiting on a photo of the student's VMC module index. The "vmc module" step exists on chapter pages.
- `ANTHROPIC_API_KEY` is reserved for planned AI features (study plans, mock analysis) that haven't been built yet.
- QFT and QFT 11 are "coming soon" (inactive). When they're activated: set `active: true` in `build-data.mjs` SERIES, add dates, and check the syllabus parsing (they currently use `{kind:"full"}`).
- `src/app/not-found.tsx` still uses v1 styles (`font-display`, which is undefined, and `bg-hot`). It's off-design, so restyle it with the §6 language if you touch it.
- The `hot` token is legacy, and confetti colours are hard-coded (`lib/celebrate.ts`).
- The `admins` table and `ADMIN_EMAILS` must be kept in sync by hand.
- The admin `listUsers` calls fetch a single page of 500 users, which is fine at this scale.
- The README still mentions a "daily/weekly" college game. It is **weekly only** now.
- **`pg_cron` isn't installed** on the Supabase project (checked 2026-10-26), so the 15-minute reminders job from the plan_reminders migration can't exist: push reminders aren't firing. Enable `pg_cron` + `pg_net` and run the schedule SQL at the bottom of that migration.
- `/api/chat/notify` counts pushes with `sent += await …` inside `Promise.all`, which under-counts (only the returned number; every push is sent).

## 12. Timeline (git)

| Date | Commit |
|---|---|
| 2026-10-05 | `4e298bc` first phase: syllabus, tracker, focus, sync, admin, MathonGo tests, chat. `a3e235c` mobile perf + chess. |
| 2026-10-06 | `9c873bc` planner, notes, weak spots, push reminders |
| 2026-10-07 | `6b2dea0` headlines. `8bcea22` admin panel rebuild into tabs, TZ fix. |
| 2026-10-12 | `a7006c8` chat reactions, ticks, presence, push; editable study log; weekly college game v2; rules scroll; login hardening |
| 2026-10-13 | `9f27bcf` Quizrr (schedule, scores, college score, admin dates). `f049a79` NSE olympiad countdowns. |
