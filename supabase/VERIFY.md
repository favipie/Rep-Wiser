# Live integration verification
Use a disposable Supabase project and two confirmed users A/B. Do not run destructive checks against a production journal.

1. As anonymous, select each private table and call read_journal/save_journal. Expect permission denial.
2. As A, read the empty journal (revision 0), save a draft (revision becomes 1), read it, complete it, sync, reload, edit a set, sync, reload. Verify exact weights/reps and status.
3. As B, read_journal must return B's empty journal. Directly select A's owner_id from every table; expect no rows.
4. As B, attempt to insert/update/delete rows using A's owner_id or reference A's session/performed IDs. Expect RLS or composite foreign-key rejection.
5. As A, call save_journal twice with the same expected_revision. The second must fail and the first data must remain.
6. Submit an invalid set within a save and verify all pre-existing records remain (transaction rollback).
7. Delete an A session, sync, reload; verify its performed exercises, sets, recommendations are removed and record aggregates recompute.
8. Sign out. Verify A's journal is not displayed. Sign in as B and verify A's device cache is never rendered.
9. Disconnect the network while editing. Refresh an already cached page; verify draft survives, cloud sync errors preserve the device copy.
10. On two devices, edit independently. Verify stale sync fails, then export the stale journal for reconciliation.

These steps require external credentials and have not been claimed as executed.
