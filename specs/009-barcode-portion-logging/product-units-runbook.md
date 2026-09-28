# Product-unit normalization runbook

Run the normalizer from `Backend/`. It converts usable legacy package and
serving pairs to Base-unit values and lowercase compatibility units. It leaves
unsupported, ambiguous, incomplete, non-finite, zero, or negative legacy pairs
untouched and clears their Base unit. The operation is idempotent.

## Local Docker

1. From the repository root, run `( unset DATABASE_URL; docker compose up -d )`, then return to `Backend/`. `Backend/.env` points at `localhost:55432`.
2. Run `( unset DATABASE_URL; npm run db:normalize-product-units -- --dry-run )` and review the counts.
3. Run `( unset DATABASE_URL; npm run db:normalize-product-units )`.
4. Run `( unset DATABASE_URL; npm run db:normalize-product-units -- --verify )`. It must report zero distinct violations.
5. Re-run `( unset DATABASE_URL; npm run db:normalize-product-units )`. It must report zero changed rows, proving idempotency.

Each command prints only the target database host, never credentials.
The report lists unrecognized unit tokens only as aggregate counts and lists
empty pairs separately. A null `containerKey` is read as the generic
`PACKAGE` presentation key.

User-submitted products remain un-normalized until the user-submission work is
implemented. Re-run normalization and verification after that work and again
before the contract step removes the compatibility unit columns.

## Production Supabase

Production execution requires the owner's explicit request in the current
session and must happen only after the local sequence passes. Never edit
`Backend/.env`, never print `.env.supabase`, and never run these commands as
part of authoring this runbook. Stop the Railway backend for the full
dry-run→normalize→verify sequence so older writers cannot race it.

```sh
( unset DATABASE_URL; set -a; . ./.env.supabase || exit 1; set +a; : "${DATABASE_URL:?failed to load .env.supabase}"; npm run db:normalize-product-units -- --dry-run )
( unset DATABASE_URL; set -a; . ./.env.supabase || exit 1; set +a; : "${DATABASE_URL:?failed to load .env.supabase}"; npm run db:normalize-product-units )
( unset DATABASE_URL; set -a; . ./.env.supabase || exit 1; set +a; : "${DATABASE_URL:?failed to load .env.supabase}"; npm run db:normalize-product-units -- --verify )
( unset DATABASE_URL; set -a; . ./.env.supabase || exit 1; set +a; : "${DATABASE_URL:?failed to load .env.supabase}"; npm run db:normalize-product-units )
```

Restart Railway only after verify passes and the final normalization reports
zero changed rows. If verify fails, inspect the printed `row-id:dimension`
references and do not proceed to the contract step that removes legacy units.

## Coverage

Verification covers only the selected database. Environment coverage beyond
it is unknown.

## Run log

| Environment | Date | Rows | First run changed | Verify | Idempotent rerun |
|---|---|---:|---:|---|---:|
| Local Docker | 2026-09-28 | 10 | 8 | 0 violations | 0 |

The dry run and real run both found 10 rows: 7 package pairs and 6 serving
pairs needed normalization across 8 distinct rows. Three package pairs and
four serving pairs stayed intentionally absent, including 3 empty pairs; the
unrecognized-token summary was `oz → 2, portion → 1`. The added legacy
aliases proved `grams`/`gr.` → G, `litre`/`centilitres` → ML, `fl. oz` →
ML, and `مل`/`ملل` → ML. Verify then reported 0 violations and the
rerun changed 0 rows. All ten local seed rows (`t1` through `t10`) were deleted
after the recorded run; 0 remain.
