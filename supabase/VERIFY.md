# Disposable database verification

The imported SQL verification script was replaced: it relied on direct target writes that this migration now forbids. Use `scripts/test-targets-stack.mjs` against real local Supabase. It creates disposable users, authenticates through GoTrue, and calls PostgREST with their JWTs. It does not simulate auth.uid or RLS.

Prerequisites: Docker-compatible runtime, Supabase CLI, Node 24, pnpm, and PostgreSQL psql. The checked-in config identifies a separate local verification project. Do not link it to a hosted project.

```sh
pnpm install --frozen-lockfile
supabase start
node scripts/test-targets-stack.mjs
supabase stop --no-backup
```

The runner reads local keys from `supabase status -o json` without printing them and refuses non-loopback API/database hosts. It checks source/exercise ownership, anonymous denial, RLS isolation, direct INSERT/UPDATE/DELETE denial, invalid prescriptions, stale fingerprints, immutable IDs, simultaneous decisions, journal resynchronization, destination ownership/provenance, idempotent application, edited/deleted sources, retained history, rollback/reinstall, and duplicate-install refusal. User cleanup runs on assertion failure. Rollback runs only after those disposable users are removed.

The GitHub workflow runs the same suite on an isolated runner. Unit tests alone are not evidence these database checks passed. Review the actual result before applying the migration.

## Migration behavior

Targets use soft references because save_journal reconstructs journal tables. Authenticated clients have SELECT only, scoped by RLS. Security-definer RPCs use an empty search path and explicit owner filters. Each decision takes the same profile row lock as save_journal, computes the server exercise-history fingerprint, checks the synced revision and engine version, and compares the expected active target before replacement. Replacements receive new immutable IDs; old records remain superseded. Rejection retires the previous active decision too.

The fingerprint includes completed same-exercise history through the source, preferences, and custom exercise definition. Newer completed workouts separately invalidate old targets. Application requires a subsequent completed owned session with matching exercise, target ID, selected load and planned prescription. Logged results may differ from the plan. Application is retryable for the same destination. Missing/edited sources remain in decision history but cannot be used.

The profile lock serializes the supported journal/target RPC workflow. Existing journal tables still allow owner-scoped direct CRUD under the original migration; arbitrary direct journal writes do not take this lock. This PR preserves that existing API contract. External integrations should use the journal RPC for serialization.

This migration is for installations without the target table. If an earlier target migration has run, stop and prepare a forward migration after inspecting its data. Do not run this file or its destructive rollback over an existing installation.

## Production gate

No production database was touched. Obtain explicit approval after reviewing the migration and successful real-stack results. Back up the database, apply only the target migration after the journal migration, then deploy the matching client. Rollback permanently deletes target decisions; export them before considering rollback. Journal data is not deleted by target rollback.
