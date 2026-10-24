# Workout Intelligence integration

## Provenance

GitHub main at import: `2a4c5c63a7b27f234ec8d153492ef76b26076725`. The supplied patch imported cleanly and its final tree exactly matched bundle head `fd9161751598eae98290abf04f6c1b1ba1a2cfbc` before new work. Claude supplied the deterministic engine, detailed analysis/charts, plan tracker, navigation, 58 additional tests, and proposed migration. The separate `Pasted markdown.md` report was not found; the pasted activity log is not treated as verification.

New work adds acceptance/modification/rejection controls, decision history, explicit application inside draft workouts, device-only persistence with cross-tab locking, cloud RPC persistence, stale checks, expected-active conflicts, completed-workout target consumption, and hardened SQL. Device mode remains accessible with Supabase configured. Finishing awaits sync before opening analysis. Targets are never automatically applied to templates or new workouts.

## Data and recovery

- Device decisions stay in `repwise:targets:v1:guest`; account decisions live in the cloud table. Signing in does not silently migrate device decisions.
- Cloud decisions require a synced journal and matching revision. An unavailable backend/migration shows an error without claiming success.
- Applying a target replaces only uncompleted working sets after confirmation and preserves warm-ups. Completed sets block application. New workouts do not reuse template target IDs.
- Source/history/settings changes and newer completed sessions invalidate old targets. Reopen current analysis and decide again. Replaced/rejected records remain visible.
- Journal save and target application are separate requests. A lost second response is safe to retry with Sync; application is idempotent for the same workout. Sync remains available when the journal is clean.
- Device decisions require Web Locks and browser storage. Failures are reported. Clearing browser data deletes device targets.

## Validation and release

Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`. The integration run passed 105 tests: 82 imported/original, 21 new target tests, and two analysis regressions. Mixed working loads are no longer treated as comparable, and extra sets cannot mask another exercise's missing sets. See current PR checks for later results. `supabase/VERIFY.md` describes real-stack verification. Docker, PostgreSQL and Supabase CLI were unavailable on the Windows authoring machine; database claims require an actual successful CI/local-stack run.

Mobile controls use two-column inputs and wrapping actions. Manual small-screen, keyboard, offline and two-browser account checks remain a release gate unless separately recorded as passed.

1. Review the branch and migration; require real-stack CI to pass.
2. Exercise device/account modes, first workout, decisions, replacement/rejection, application, source edit/deletion and network retries.
3. Confirm the target migration has not already run. Never overwrite an existing target table.
4. Obtain explicit approval for merge, production migration and deployment.
5. Back up production, apply the reviewed migration, build with intended public Supabase values, deploy the static export and verify account isolation.
6. Check service-worker upgrades and retain journal/decision exports before any rollback.

## Ask REPWISE proposal — not implemented or deployed

Keep static hosting. A Supabase Edge Function should validate the bearer session, enforce explicit consent and per-user limits, and call a model using a server-side secret. Accept a bounded question and source IDs, never an arbitrary owner ID or entire journal. Retrieve only the authenticated user's relevant records and deterministic facts; validate structured output and reject invented numerical claims. Treat workout notes as untrusted content, never instructions.

Before implementation review provider retention terms, shared fields, consent and withdrawal, redacted logging, cost limits, and persistent rate-limit storage. No service-role secret belongs in the static bundle; use user-scoped journal reads. Return deterministic analysis on missing consent, auth failure, timeout, quota exhaustion or invalid model output. This PR adds no AI processing, model key or AI migration.

Reference: [Supabase local development](https://supabase.com/docs/guides/local-development/cli/getting-started).
