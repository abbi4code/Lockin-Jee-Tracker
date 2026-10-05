# lockin.

A JEE Main + Advanced 2027 tracker (installable PWA) built with Next.js 16 (App Router).
Syllabus, weightage and resources come from `research/` and ship inside the app; Supabase stores accounts, progress and focus sessions.

## Run it

```
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm start          # serve the production build (offline support works here, not in dev)
```

Without Supabase keys the app runs in local-only mode (no accounts, progress saved on the device).

## Pages

| Path | What |
|---|---|
| `/` | Landing page |
| `/login`, `/signup` | Accounts (email + password) |
| `/today` | Dashboard: countdown, what to study now, syllabus progress, streak, pace |
| `/s/[subject]`, `/c/[chapter]` | Subjects and chapters with topic checklists |
| `/focus` | Pomodoro / stopwatch focus timer; sessions are logged |
| `/me` | Profile, exam scope, sign out, backup |
| `/admin` | Admin panel: every student's progress, study time and MathonGo scores; log/fix results; one-time Excel import (admins only) |

`src/proxy.ts` sends signed-out visitors to `/login` and keeps non-admins out of `/admin`.

## Supabase setup

1. `.env` (see `.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Project Settings → API.
   - `SUPABASE_SECRET_KEY`: server-only, used by the admin panel. Never prefix it with `NEXT_PUBLIC_`.
   - `ADMIN_EMAILS`: comma-separated emails allowed into `/admin`.
2. Apply `supabase/migrations/*.sql` in order: `npx supabase db push`, or paste each file into the SQL Editor (safe to re-run).
3. Authentication → URL Configuration: Site URL `http://localhost:3000` (your real domain once deployed), and add `http://localhost:3000/auth/callback` to Redirect URLs.
4. Optional: Authentication → Sign In / Providers → Email → turn off "Confirm email" so sign-up logs in instantly.

## Data

- `research/*.json`: source research. `node research/tools.mjs validate` checks it.
- `scripts/build-data.mjs`: packs it into `src/data/jee.json` (runs before dev/build).
- `research/colleges-*.json`: JoSAA 2025 final-round closing ranks (IITs, NITs, IIITs) and BITSAT 2025 cutoffs. The build packs them into `src/data/colleges.json`, the ladder for the daily/weekly college game (`src/lib/college.ts`).
