# Backfill runbook: legacy food log amounts (ticket 02)

Run every command from `Backend/` in Git Bash, in this order per
environment: snapshot → backfill → verify → compare. The backfill is
idempotent; re-running it changes nothing.

## Local Docker

1. Run `( unset DATABASE_URL; docker compose up -d )` from the repo root, then return to `Backend/`. `Backend/.env` points at `localhost:55432`.
2. Confirm a quiet window with no active users, then run `( unset DATABASE_URL; npm run db:backfill-amounts -- --snapshot "$TEMP/amounts-before.json" )`.
3. Run `( unset DATABASE_URL; npm run db:backfill-amounts -- --dry-run )`, then `( unset DATABASE_URL; npm run db:backfill-amounts )`.
4. Run `( unset DATABASE_URL; npm run db:backfill-amounts -- --verify )` — it must report zero distinct violating rows.
5. Run `( unset DATABASE_URL; npm run db:backfill-amounts -- --compare "$TEMP/amounts-before.json" )` — it must report no differences.

## Production Supabase

Run the same five commands (snapshot, dry-run, backfill, verify, compare), but
each command runs in a subshell with a load guard, so
the URL never leaks into the shell (never edit `Backend/.env` for this).
A production run is a deliberate step: complete the full local sequence
first, then run these. If Prisma times out reaching the pooler, append
`connect_timeout=30` to the URL inside the subshell (after sourcing).

Before the snapshot, stop the backend service in the Railway dashboard. Keep
it stopped through compare, then restart it after compare completes.

```sh
( unset DATABASE_URL; set -a; . ./.env.supabase || exit 1; set +a; : "${DATABASE_URL:?failed to load .env.supabase}"; npm run db:backfill-amounts -- --snapshot "$TEMP/amounts-before.json" )
( unset DATABASE_URL; set -a; . ./.env.supabase || exit 1; set +a; : "${DATABASE_URL:?failed to load .env.supabase}"; npm run db:backfill-amounts -- --dry-run )
( unset DATABASE_URL; set -a; . ./.env.supabase || exit 1; set +a; : "${DATABASE_URL:?failed to load .env.supabase}"; npm run db:backfill-amounts )
( unset DATABASE_URL; set -a; . ./.env.supabase || exit 1; set +a; : "${DATABASE_URL:?failed to load .env.supabase}"; npm run db:backfill-amounts -- --verify )
( unset DATABASE_URL; set -a; . ./.env.supabase || exit 1; set +a; : "${DATABASE_URL:?failed to load .env.supabase}"; npm run db:backfill-amounts -- --compare "$TEMP/amounts-before.json" )
```

## Coverage

Verified only for the configured database. Environment coverage beyond it is unknown.

## Verify failures

If verify reports violations after the backfill, list the violating ids shown
in its output. Rows with both `amount` and `grams` null are unbackfillable by
design and need a manual decision. Do not proceed to the contract step that
retires `grams` until verify reports zero distinct violating rows.

## Compare failures and concurrent writes

If compare reports extra, missing or changed rows, check whether the app wrote
during the snapshot→compare window. Rerun snapshot→compare in a confirmed
write-free window before treating the result as a backfill defect. The
backfill writes only amount/amountUnit/portionKind and never computed nutrition.

## Run log

| Environment | Date | Before (total / null) | Updated | Verify | Compare |
|-------------|------|-----------------------|---------|--------|---------|
| Local Docker (4 rows reset to legacy state) | 2026-09-28 | 14 / 4 | 4 (rerun: 0) | 0 violating rows | 0 changed / missing / extra |
| Production Supabase | 2026-09-28 | 0 / 0 | 0 | 0 violating rows | 0 changed / missing / extra |

Production held no food log entries at the time of the run, so the backend
service was not stopped: there was nothing for a concurrent write to race.
