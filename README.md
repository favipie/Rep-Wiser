# REPWISE
A mobile-first Next.js workout journal with an editorial landing page, local-first workout editing, Supabase accounts, transparent progression, and charts from logged records.

## Run
Requires Node.js 20.9+ and pnpm.
```sh
pnpm install
pnpm dev
```
Open http://127.0.0.1:3000. Without Supabase variables, choose **Continue on this device**. Device mode is a real local journal, not seeded demo data. Clearing browser data deletes it; export backups in Settings.

## Accounts
1. Create a Supabase project.
2. Run `supabase/migrations/202610210001_journal.sql` in its SQL editor, or use Supabase migrations.
3. Copy `.env.example` to `.env.local`. Set the public project URL and publishable/anon key. Never use a service-role key.
4. Configure Supabase Auth's Site URL and allowed redirect URL to your deployed origin. Enable email/password and email confirmation.
5. Restart the app, register, confirm your email, and sign in.
6. Finishing a workout syncs automatically. Press **Sync** after other edits to persist the journal to your account. Changes immediately persist to user-scoped local browser storage. Explicit cloud sync uses a transaction and a revision check. On conflict, device data stays intact; export it before reconciling cloud changes.

Guest and account journals are separate. Signing in does not automatically migrate a guest journal. JSON export is provided; automatic import/merge is not implemented.

## Features
- Preferences: goals, experience, units, split, training days, equipment, load increments, RIR targets.
- Workout templates with weekday assignments; open workouts and drafts.
- Searchable exercise library and custom movements.
- Reorder/remove exercises; weight/reps/RIR; warm-ups; completion; duplicate sets; notes; rest timer; technique/pain flags; custom rep ranges; per-exercise increments; next-load override.
- Historical workout editing and deletion with confirmations.
- Dashboard, records, consistency calendar, exercise charts, date filters, frequency, primary-muscle hard sets.
- Static-export PWA shell and previously loaded assets cached for offline use. Account authentication and cloud synchronization require internet. Device drafts survive refresh.
- Supabase normalized tables, owner RLS, indexes, transactional save/read RPCs, optimistic concurrency.

## Calculations
Loads are stored in kg and converted for lb display. Warm-ups and uncompleted sets are excluded. Progression requires all prescribed sets at a consistent working load, upper rep target met, known RIR within user range, acceptable technique, and no pain concern. Missing RIR holds load. Three comparable sessions are required for a declining-performance review. Users can explicitly override numerical suggestions. Estimates use Epley on 1–12 reps. Nothing estimates or guarantees muscle growth.

The landing interaction is explicitly synthetic. User dashboards start empty.

## Check
```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
If the Windows pnpm store is unavailable in a restricted shell, the equivalent commands are:
```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/vitest/vitest.mjs run
node scripts/build.mjs
```
Live Supabase integration tests require a disposable configured project and two confirmed test accounts. See `supabase/VERIFY.md`.

## Deployment
Next is configured for static export to `out/`. Serve this directory with trailing-slash routing on any HTTPS static host. Public Supabase variables are compiled at build time: configure them before building, then redeploy when changed. The database enforces private access; route shells contain no private user data. Sites identity is tracked in `.openai/hosting.json`. Alternatively remove `output: 'export'` for a conventional Next server deployment.

## Artwork
`public/hero.png` was generated with the built-in image-generation tool. Prompt: “Original editorial REPWISE hero: monochrome pencil/stippled hand holding a dark workout-tracking smartphone, off-white paper, acid-lime digital silhouette and binary texture; entire phone visible; no external headline or watermark.” Source references informed texture and palette, not a copied final composition.

## Sources
- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase password auth](https://supabase.com/docs/guides/auth/passwords)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [ACSM progression models position stand](https://pubmed.ncbi.nlm.nih.gov/19204579/)

## Verification limits
Local checks do not certify production readiness. Live email delivery, RLS behavior on an actual database, multi-device conflict handling, install prompts across platforms, and offline behavior after deployment require configured integration checks.

## Latest local checks
24 unit tests pass (progression and journal storage), ESLint passes, and the optimized Next.js production build passes TypeScript. Browser automation was blocked by the browser access policy, so visual and end-to-end browser verification remain unverified. The Sites installer/build wrapper could not locate its package-manager executable on this Windows host; equivalent direct Node commands were used successfully.
