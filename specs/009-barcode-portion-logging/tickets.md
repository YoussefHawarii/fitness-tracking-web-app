# Ticket plan: unit-aware portion logging for barcode products

Status: **stable — reviewed; owner decisions 1–2 applied (2026-09-21); awaiting owner approval to publish.** Not yet published
to the issue tracker.

Source of truth: `spec.md` in this folder (cited as **S§x**), backed by
`docs/portion-model-decisions.md` (the decision register, **R§n.n**),
`docs/off-nutrition-basis-evidence.md`, `CONTEXT.md`, and ADRs 0004–0007. The
spec's own hierarchy applies unchanged: where the spec and those documents
disagree, the documents win. Tickets use the glossary's terms exactly.

## Conventions applying to every ticket

- **Definition of Done (shared)**, in addition to each ticket's own list:
  - backend unit tests pass (`npm test`), and e2e tests are run locally whenever
    backend behaviour changes (AGENTS.md — e2e is not in CI);
  - frontend tests pass (`node --test`), frontend builds (`tsc -b && vite build`);
  - lint passes in both packages;
  - every provider response used in a test is a **deterministic recorded
    fixture** — no test calls live Open Food Facts;
  - Frontend and Backend `package.json` versions are bumped **in sync** on every
    ticket (project convention, S§M4);
  - any schema change is applied with `prisma db push` + `prisma generate` and
    never requires a database reset. **No ticket may lose unverified data.**
    Only the contract ticket (14) may acknowledge dropping legacy columns, and
    only after both verification gates pass, the pre-contract snapshot is
    archived, and the owner approves that push;
  - no deferred item from S "Out of Scope" is fixed in passing.
- **Implementation areas** name modules and models, not file paths, so they
  don't go stale.
- **Implementation-time decisions** (S "Left to implementation on purpose") are
  recorded in **one place**: decision register §9, "Implementation-time
  decisions" (9.1 container keys → 03; 9.2 compatibility mechanism → 01;
  9.3 free-text fallback → 03; 9.4 transient-error backoff → 10), kept
  distinct from §7 (deferred feature work). The spec is not rewritten. An implementation note never overrides a
  settled requirement; if a decision would, stop and ask the owner.
- **Release batch.** Ticket 05 may merge, but must not reach production until
  06 is deployed with it (S§M3: the Nutrition safety invariant holds throughout
  the transition). How that is enforced is part of decision #2 in ticket 01.
  Between 01 and 06, entries are recorded in grams, which is exactly their
  meaning at write time (S§K2).

## Order and blocking edges

| # | Ticket | Blocked by |
|---|---|---|
| 01 | Expand food log entries (dual-write) + decision #2 | — |
| 02 | Backfill and verify legacy amounts | 01 |
| 03 | Normalize OFF and imported product metadata + decisions #1, #3 | — |
| 04 | Technical input validation (shared validator) | — |
| 05 | Resolve Portion dimension and Effective basis; Not-scalable UI | 01, 03 |
| 06 | Safe create path in the product's own unit | 04, 05 |
| 07 | Portion selector, Scenarios A–E | 06 |
| 08 | Safe edit and history units | 07 |
| 09 | Plausibility advisory | 08 |
| 10 | Identified-but-not-cataloguable barcodes + 30-day retry policy + decision #4 | 05 |
| 11 | Lazy re-hydration | 10 |
| 12 | USER_SUBMITTED requires a Declared basis | 06, 10 |
| 13 | OCR basis suggestion | 12 |
| 14 | Contract: retire `grams` and free-text unit columns | 02, 03, 08, 12 |

Edges are minimal blockers. Transitive prerequisites are noted in each ticket
where they matter. Parallel lanes: {01→02}, {03}, {04} can start at once; after
05, the create/selector/edit lane (06→07→08→09) and the catalog lane (10→11,
10→12→13) proceed independently.

---

## 01 — Expand food log entries with an explicit amount and unit (dual-write)

**Goal.** Introduce `amount`, `amountUnit`, `portionKind` and `portionMultiplier` on food log entries alongside the existing `grams`. Every write populates both representations and every read prefers the new one, with no visible behaviour change.

**Why it exists.** It is the *expand* step of the expand–contract rollout that S§M1 requires under `db push`. Every later ticket that stores a Consumed amount in ml needs these columns, and `grams` can't be dropped until all writers and readers have moved.

**Scope.**
- Additive schema: a Base unit enumeration (G, ML), a Portion choice kind enumeration (PACKAGE, SERVING, CUSTOM), and nullable `amount`, `amountUnit`, `portionKind` and `portionMultiplier` on food log entries.
- Every create and update path writes `amount = grams` and `amountUnit = G` alongside `grams`, for every source type (manual, USDA, canonical, local, voice, packaged product, legacy OFF).
- Log-entry responses expose `amount` and `amountUnit` alongside the existing fields.
- Every existing `grams` reader moves to `amount ?? grams`, named explicitly:
  - backend: the calorie calculation read, the update path and log-entry serialization;
  - frontend: the food-service log-entry type, history rendering and edit pre-fill.
- **Implementation-time decision #2 (decide here, before any request shape changes):** the deployment-compatibility mechanism for the staged rollout (S§M3). Inspect the actual Vercel/Railway deploy setup, then choose how frontend and backend avoid a window in which valid requests break, in either deploy order. Candidates include accepting the old `grams` request field for a transition, ordering deploys, or versioned request shapes. The decision must also define:
  - how the **05 + 06 release batch** reaches production together;
  - how an **ML entry is represented during the transition** (what, if anything, `grams` holds for it), and therefore how ticket 14's gate verifies ML rows without reinterpreting them as grams;
  - how the log-create/update contract changes (06, 08), the barcode-lookup response (05, 10) and the product-submission contract (12) stay compatible with an older deployed frontend.

  Record the decision and its evidence in the register's "Implementation-time decisions" section.

**Out of scope.** Any millilitre amount; request-shape changes (06); backfill of existing rows (02); dropping `grams` (14).

**Blocked by.** None.

**Spec requirements / acceptance criteria.** S§K1, S§M1 step 1, S§M3, S§C4.
- [ ] Schema changes are purely additive; `db push` applies them without data loss.
- [ ] Every new entry, from every source type, has `amount` equal to `grams` and `amountUnit` G.
- [ ] Updating an entry's amount keeps `grams` and `amount` equal.
- [ ] Responses include `amount` and `amountUnit`, and existing response fields are unchanged.
- [ ] Every named reader falls back to `grams` when `amount` is null.
- [ ] Decision #2 is recorded with its evidence and covers the three points above.

**Implementation areas.** FoodLogEntry model; FoodService create and update paths; the calorie calculator (read side); log-entry response serialization; the frontend food service and the FoodLog page's history/edit rendering.

**Required tests.** At the service seam (prior art: the food-log edit/delete spec):
- dual-write on create, for each source type;
- dual-write on update;
- reads fall back to `grams` when `amount` is null.

At the frontend seam, a compatibility test: a log-entry response containing only `grams` still renders and pre-fills edit. The existing food-name-capture and edit/delete specs stay green.

**Edge cases.** Legacy OFF entries and orphaned packaged-product entries are written by their existing paths. They must also dual-write, with no other behaviour change.

**Definition of Done.** Shared DoD, plus the decision record exists.

---

## 02 — Backfill and verify legacy food log amounts

**Goal.** Give every pre-existing food log entry `amount = grams`, `amountUnit = G` and `portionKind = null`, and prove it.

**Why it exists.** `db push` does not backfill data (S§M1). The contract step (14) must not run until every row in each environment has been verified (S§M2).

**Scope.**
- A one-off, **idempotent** script following the repo's existing one-off Prisma script pattern. It fills only rows where `amount` is null, and reports counts before and after.
- A **verify mode** for historical rows. It reports any row with a null `amount` or `amountUnit`, or any G row with `amount ≠ grams`, and exits non-zero if any exist. ML rows are verified under the representation defined by decision #2 (01) and are never required to equal `grams`.
- Operator procedure, for every environment:
  1. take a before-snapshot of each entry's computed calories and macros;
  2. run the backfill;
  3. run verify;
  4. compare against the snapshot.

  Environment coverage beyond the configured database is unknown (S§M2), and the notes say so.

**Out of scope.** Changing any computed nutrition; reinterpreting any historical amount as ml (S§K2, R§6.3). Orphaned and legacy OFF rows get the same mechanical backfill and nothing more.

**Blocked by.** 01.

**Spec requirements / acceptance criteria.** S§K2, S§M1 steps 2–3, S§M2; fixture 24.
- [ ] Running the script twice produces the same result as running it once.
- [ ] After a run, verify mode reports zero violations.
- [ ] The script writes only `amount`, `amountUnit` and the null Portion-choice state, and never a computed nutrition field.
- [ ] On the configured database, the operator comparison shows computed calories and macros unchanged.
- [ ] Orphaned `PACKAGED_PRODUCT` and legacy `OPEN_FOOD_FACTS` rows are backfilled like every other row.

**Implementation areas.** A script beside the existing Prisma import script; FoodLogEntry model.

**Required tests.** Script logic tested against a faked Prisma client:
- idempotency;
- count reporting;
- the written field set is exactly the three above;
- verify mode detects a null-amount row and a mismatched G row.

**Edge cases.** An empty table; rows written by 01's dual-write are already populated and left untouched; decimal precision is preserved exactly.

**Definition of Done.** Shared DoD. The operator procedure has run, and verify has passed, against the configured database. Operator notes exist for other environments.

---

## 03 — Normalize Open Food Facts and imported product metadata

**Goal.** Every product entering the catalog, from Open Food Facts or the bulk import, stores Package size and Serving size in Base units plus an app-owned container key. OFF data comes from OFF's structured numeric fields. Existing product rows get normalized units too.

**Why it exists.** Everything portion-related depends on trustworthy, normalized package and serving data. Today the OFF client regex-parses free text and discards servings like "1 portion (330 ml)" (S§E1). Cached products must behave the same on every later scan (S story 14).

**Scope.**
- Unit normalization to G/ML per S§D1–D4, as one shared normalizer that 12 reuses for user submission:
  - kg and mg become g; L, cl and dl become ml; fl oz becomes ml;
  - bare oz, "portion", "piece", "bar" and unrecognised units become **absent**;
  - non-finite, zero or negative quantities become absent.
- The OFF client reads `product_quantity`/`product_quantity_unit`, `serving_quantity`/`serving_quantity_unit` and `packagings[].shape`.
- The provider-lookup result type and the OFF provider adapter carry the new fields, so a future provider maps into the same shape (S§E5).
- Additive schema on Packaged product: normalized package and serving unit columns (Base unit enumeration) and a container key column. These sit next to the existing free-text unit columns until 14.
- **Writers moved to the normalized columns:**
  - the provider upsert;
  - the **bulk packaged-product import script**, which today spreads free-text `packageUnit`/`servingUnit` straight into creation.

  (User submission moves in 12.)
- An idempotent normalization step for existing product rows, with a **verify mode** whose semantics are:
  - every usable legacy size/unit pair has the expected normalized value and Base unit;
  - every ambiguous, unsupported, incomplete, non-finite, zero or negative pair is confirmed as *intentionally absent*;
  - no normalized value disagrees with a successfully parsed legacy value.

  Verify exits non-zero on any violation.
- **Implementation-time decision #1 (decide here, before mapping code):** the final app-owned container keys and the OFF shape-tag mapping (S§G6).
  - Record real `packagings[].shape` responses from the single-product endpoint for a spread of products as fixtures.
  - Inspect the tags OFF actually supplies, then fix the key set.
  - PACKAGE is always the generic fallback, and the keys are presentation-only.
- **Implementation-time decision #3 (decide here):** whether conservative free-text parsing of `quantity`/`serving_size` remains as a fallback when the numeric fields are absent (S§E1). Base it on how often the numeric fields are missing in the recorded fixtures. Whichever is chosen, S§D2's no-guessing rule holds.
- Record both decisions in the register's "Implementation-time decisions" section.
- Update the Packaged product schema comment that describes nutrition as per 100 g "including for liquids", so it states the per-100-Base-units meaning (ADR 0006, S§B1).

**Out of scope.** Portion dimension and basis resolution (05); the three-way found / found-without-calories / not-found outcome (10); re-hydration (11); user-submitted normalization (12).

**Blocked by.** None. Can run in parallel with 01, 02 and 04.

**Spec requirements / acceptance criteria.** S§D1–D5, S§E1, E2, E4, E5, S§G6 (key capture), S§B1 (documentation), S§B6 (the client still never reads `nutrition_data_per` as a basis); fixtures 8 and 9.
- [ ] 0.33 L, 33 cl and 330 ml all normalize to 330 ml; 1.5 L to 1500 ml; 0.06 kg to 60 g.
- [ ] fl oz normalizes to ml; bare oz, "portion" and "1 bar" normalize to absent.
- [ ] A serving given only as `"1 portion (330 ml)"` with numeric `serving_quantity` 330 ml is captured as 330 ml.
- [ ] `packagings[].shape` maps to a container key; an unmapped or absent shape maps to PACKAGE; raw tags such as `en:drink-can` are never persisted as labels.
- [ ] The new fields reach the provider-lookup result through the OFF provider adapter.
- [ ] The import script writes normalized columns.
- [ ] Nutriment handling is unchanged, and missing nutrients are never zero.
- [ ] Existing product rows are normalized idempotently, and verify passes under the semantics above.
- [ ] Decisions #1 and #3 are recorded with evidence.

**Implementation areas.** OpenFoodFactsClient; the OFF provider adapter and provider-lookup result type; PackagedProductService upsert; the packaged-product import script; Packaged product model; a normalization script.

**Required tests.**
- OFF-client seam with mocked `fetch` (prior art: the OFF client spec):
  - the full unit table and ambiguous units;
  - numeric-over-free-text precedence;
  - container mapping;
  - **a volume-based fixture** (the suite has none today, S 6.4).
- A provider-adapter contract test.
- Import-script normalization.
- Normalization-script idempotency, plus verify catching each violation class.

**Edge cases.**
- A package quantity with a unit but no number, and a number with no unit, both become absent.
- Serving and package in different dimensions are both captured here; discarding happens at resolution (05).
- Contributor noise such as `"500ml مل"` relies on the numeric fields, never on the text.

**Definition of Done.** Shared DoD, plus both decisions recorded.

---

## 04 — Technical input validation for Consumed amounts and multipliers

**Goal.** One shared, well-tested validator decides whether a Consumed amount or Portion multiplier is technically acceptable, with specific, machine-readable rejection reasons.

**Why it exists.** S§H makes technical validation server-enforced and identical on create and edit. Extracting it keeps the create ticket (06) focused and gives edit (08) the same rules by construction.

**Scope.**
- Rejects non-numeric, NaN, ±Infinity, ≤ 0, more than **one decimal place**, and ≥ 1 000 000 000 (S§H1).
- The bound is a named technical constant (proposed `MAX_SAFE_CONSUMED_AMOUNT_INPUT`), with a comment giving S§H2's justification. It is never named or documented as a consumption maximum.
- Multipliers are validated the same way (S§H5).
- Each rejection carries a specific reason code.
- Plausibility is **not** here (09).
- Precision (S§H4): only the input is validated to one decimal place; nothing here rounds calculation intermediates.

**Out of scope.** Wiring into request DTOs and transport-level tests (06 for create, 08 for edit); plausibility; any consumption ceiling.

**Blocked by.** None. It is a pure domain module, independent of generated Prisma types.

**Spec requirements / acceptance criteria.** S§H1–H5.
- [ ] NaN, Infinity, 0, negative, two decimal places and 1 000 000 000 are each rejected with a distinct reason; 999 999 999.9 and 0.1 are accepted.
- [ ] Multipliers follow the same rules.
- [ ] The constant is named and commented as a technical limit.

**Implementation areas.** A validation module beside the food/nutrition domain code.

**Required tests.** Domain boundary tests for every rule and edge value above.

**Edge cases.** Values such as `62.8` versus `62.80` versus `62.85`; negative zero; very small positives like `0.1`.

**Definition of Done.** Shared DoD.

---

## 05 — Resolve Portion dimension and Effective nutrition basis; surface products that are Not scalable

**Goal.** A barcode lookup returns the product's Portion dimension, its Effective nutrition basis with provenance, its usable package and serving, and whether it is loggable. The scan screen refuses to offer logging for a product that is Not scalable, and explains why.

**Why it exists.** This is the domain core (S§B, C, F6) that every logging path relies on. It is also the point at which the app stops showing a confident calorie figure for a product whose denominator is unknown or self-contradictory.

**Scope.**
- **Portion dimension precedence** (S§C1): usable package unit, then usable serving unit, then Declared basis, then UNKNOWN. Never defaulted to grams.
- **Package is authoritative over serving** (S§C2). A serving with a different dimension, or one larger than the package, is discarded as a shortcut at resolution. The stored value is kept; the discard is logged for diagnostics and not shown to the user.
- **Additive schema:** a nullable Declared nutrition basis column on Packaged product (PER_100_G / PER_100_ML), populated only by user submission (12).
- **Effective basis resolution** (S§B3), with provenance: the value, origin DECLARED or INFERRED, and rule and provider when inferred.
- **The two v1 inference rules** (S§B4):
  - the **Open Food Facts rule**: OFF source only; dimension maps to basis;
  - **`LEGACY_USER_SUBMITTED_MASS_GRANDFATHERING`**: user-submitted products with no Declared basis. A MASS *package* unit gives PER_100_G; a VOLUME or missing package unit gives none, even with a serving.

  The inferred basis is reproduced deterministically at resolution and is not persisted in v1. That is a simplification, not an architectural constraint.
- **Basis conflict** (S§C3): a Declared basis that contradicts the dimension gives `DIMENSION_BASIS_CONFLICT`. It is never derived from any OFF field.
- **Resolution outcome contract** (S§F6):
  - `LOGGABLE`, with dimension, Effective basis and provenance, normalized package, usable serving and container key;
  - `NOT_LOGGABLE`, with display data, the **subject kind** (an existing Packaged product that is Not scalable) and one primary reason for presentation.

  The resolver keeps every applicable reason as internal diagnostics.
- The response evolves compatibly under decision #2 (01), so an older frontend is not broken.
- **Frontend:** when the outcome is `NOT_LOGGABLE`, the scan screen shows the product's identity and a clear "can't be logged safely" explanation for the reason. It offers the existing fallbacks (manual search, add product) and shows no amount input.
- **Release batch with 06:** this ticket must not reach production without 06.

**Out of scope.** The identified-but-not-cataloguable subject kind and `NUTRITION_MISSING` (10); the basis display line and amount input unit (06); the portion selector (07); server-side enforcement on create (06).

**Blocked by.** 01 (compatibility decision), 03.

**Spec requirements / acceptance criteria.** S§B3–B6, S§C1–C3, S§F6 (Packaged-product subject kind), S§F7; fixtures 1, 2, 3, 4, 5, 6, 7, 10 (the pre-existing-row half), 11, 13 and 15b.
- [ ] Coherent VOLUME OFF product: `LOGGABLE`, PER_100_ML, INFERRED via the OFF rule.
- [ ] Coherent MASS OFF product: `LOGGABLE`, PER_100_G, INFERRED.
- [ ] Package-only and serving-only products (fixtures 3 and 4) resolve to the correct dimension and basis, with the missing shortcut absent rather than fabricated.
- [ ] A fixture with `nutrition_data_per: "100g"` on an ml product has no effect on the outcome.
- [ ] 500 ml package with a 900 g serving: serving discarded, product loggable, discard logged, no user-facing warning.
- [ ] A serving larger than the package (same dimension) is discarded.
- [ ] OFF product with no usable package or serving: `NOT_LOGGABLE` / `PORTION_DIMENSION_UNKNOWN`.
- [ ] Legacy user-submitted rows:
  - a MASS package gives PER_100_G, INFERRED under the legacy rule (never DECLARED);
  - a VOLUME package gives `NUTRITION_BASIS_UNKNOWN`;
  - no package unit with a MASS serving gives `NUTRITION_BASIS_UNKNOWN`.
- [ ] A row with a Declared basis conflicting with its dimension: `NOT_LOGGABLE` / `DIMENSION_BASIS_CONFLICT`.
- [ ] Multiple problems: one primary reason presented, all kept in diagnostics, subject kind correct.
- [ ] The scan screen offers no logging for a `NOT_LOGGABLE` product.

**Implementation areas.** ProductResolverService (or a portion-resolution module beneath it); FoodService barcode lookup; the product serializer; Packaged product model; the FoodLog page's scan-result handling; the frontend food service types.

**Required tests.**
- ProductResolverService / FoodService barcode-lookup seam, with faked Prisma and provider (prior art: the product-resolver spec).
- Frontend seam: static render of the `NOT_LOGGABLE` panel (prior art: the barcode feature tests).

**Edge cases.** CANONICAL, LOCAL and USDA foods don't pass through this resolver and remain MASS / PER_100_G (S§C4). ADMIN products get no inference. A Declared basis with no package or serving establishes the dimension itself (step 3).

**Definition of Done.** Shared DoD.

---

## 06 — Log a barcode product safely in its own unit (create path)

**Goal.** The user logs a scanned product with a custom amount in the product's own unit ("330 ml") and sees nutrition as "42 kcal / 100 ml". The server refuses any amount it can't scale safely or that fails technical validation. An ML entry is never mislabelled or rewritten as grams afterwards.

**Why it exists.** It closes the core bug: a volume product logged in ml, with a correctly labelled basis. It also makes nutrition safety and technical validation server-enforced rather than client-trusted (S§H, I).

**Scope.**
- The create request carries amount, amount unit and Portion choice, under decision #2 (01).
- **Technical validation:** wire 04's validator into the create DTO/pipeline for amounts and multipliers, with clean 400 responses.
- **Nutrition safety** (S§I1, I3): resolve the product, then reject with the machine-readable reason when it is Not scalable or when the amount unit differs from the Effective basis. No client flag bypasses this.
- **Portion choice consistency** (S§K3):
  - `PACKAGE × m` needs a usable package and `amount = m × packageSize`;
  - `SERVING × m` needs a usable, non-discarded serving and `amount = m × servingSize`;
  - the check allows half the input precision;
  - an inconsistent structured choice is **rejected**, never rewritten as CUSTOM.
- **Retire new legacy OFF entries** (S§K4): new `OPEN_FOOD_FACTS` creates are rejected. A catalog write failure fails the scan, with no fallback to a grams-only entry.
- The calculator's arithmetic is unchanged (S§B2). Intermediate results are not rounded to input precision (S§H4).
- **Transitional ML guard (until 08 ships)** — a deployment-transition safety mechanism only, never a product or domain rule (owner decision 2):
  - history renders every entry's amount with its `amountUnit`;
  - no path reinterprets or rewrites an ML amount as grams;
  - the update path never rewrites the unit of an ML entry, and never writes it back as G;
  - an amount change on an ML entry is rejected with a clear reason, and the edit form disables the amount field for ML entries with that message;
  - for an ML entry whose Packaged product still exists, a meal-only change updates only the meal category and preserves the stored amount, unit, Portion choice and computed nutrition, without recalculation;
  - orphaned `PACKAGED_PRODUCT` entries remain uneditable under S§K8.

  08 replaces this guard with full unit-aware editing.
- **Frontend:**
  - the scan screen's nutrition line reads from the Effective basis ("`<kcal>` kcal / 100 ml"), replacing the hardcoded "kcal/100g" (S§G8);
  - the amount input is labelled in the product's Base unit, accepts one decimal place, and submits CUSTOM;
  - manual, USDA, canonical, local and voice flows submit G, with unchanged behaviour (S§C4).

**Out of scope.** Quick options and defaults (07); plausibility (09); full edit rules (08); `grams` removal (14).

**Blocked by.** 04, 05. Release batch with 05.

**Spec requirements / acceptance criteria.** S§B2, S§B5 (enforcement), S§G8, S§H1–H5 (create wiring), S§I1, I3, S§K3, S§K4, S§K9 (transitional), S§C4, S§M3; fixtures 16, 17, 18 (server half), 23 and 26.
- [ ] Each technically invalid amount and multiplier is rejected at the HTTP boundary with a specific reason.
- [ ] Grams against PER_100_ML are rejected; ml against PER_100_G are rejected; matching units are accepted and computed as `value × amount / 100`.
- [ ] Logging against a Not-scalable product is rejected with its reason.
- [ ] `SERVING × 1` with 600 ml against a 250 ml serving is rejected, and the same 600 ml as CUSTOM is accepted.
- [ ] `SERVING × m` against a discarded serving is rejected.
- [ ] A rounded amount within tolerance is accepted.
- [ ] A new `OPEN_FOOD_FACTS` create is rejected.
- [ ] A persistence failure during scan resolution fails the request, and no grams-only entry is created.
- [ ] Manual, USDA, canonical, local and voice logging behave exactly as before, with amounts in G.
- [ ] A VOLUME product shows "kcal / 100 ml" and an ml amount input.
- [ ] An ML entry shows "330 ml" in history. A meal-only edit on a non-orphaned ML entry changes only the meal category: amount, unit, Portion choice and nutrition are unchanged and nothing is recalculated. An amount edit on it is refused with a reason, and its unit is never rewritten. An orphaned ML entry stays uneditable.
- [ ] A legacy-grams request for a VOLUME product, under the chosen compatibility mechanism, is rejected by safety (S§M3).

**Implementation areas.** The create-log DTO; FoodService create and update paths; the calorie calculator (safety precondition); the FoodLog page's pending-item save, nutrition line, history and edit form; the frontend food service.

**Required tests.**
- DTO / global-pipe tests for the transport representations (malformed, non-numeric).
- Food-service seam for safety, consistency, legacy rejection and the transitional ML guard.
- Frontend seam: the basis line and input unit for VOLUME and MASS products, and ML history rendering.

**Edge cases.** An amount exactly at the half-precision tolerance boundary; a multiplier of 0.5 × 125.5 g entered as 62.8 g.

**Definition of Done.** Shared DoD. The e2e log-creation suites are updated and run locally.

---

## 07 — Portion selector with Scenario A–E defaults and quick options

**Goal.** After a scan, the user picks a portion from options built from the product's real metadata, with the right default preselected, and every option shows its resolved amount.

**Why it exists.** This is the user-facing heart of the feature (S§G, stories 16–29): scan, meal, save, with no typing in the common case and no unsafe default anywhere.

**Scope.**
- A **pure portion-options module**, reusable by both scan (here) and edit (08), plus a selector component.
- Scenario defaults (S§G2):
  - **A** (package equals serving): 1 package, persisted `PACKAGE × 1`.
  - **B** (package greater than serving): 1 serving.
  - **C** (serving only): 1 serving.
  - **D** (package only, or serving discarded): nothing preselected; whole package and custom; an explicit choice is required.
  - **E** (neither, but scalable): custom only, empty.
  - Not scalable: no selector (05 already handles this).
- Quick options (S§G3):
  - 0.5, 1 and 2 servings when a usable serving exists;
  - "Whole package" when a package exists;
  - custom.

  No 1.5 button and no multiplier. Any amount is still reachable via custom.
- Whole package is explicit except in Scenario A (S§G4). No size-based heuristics (S§G1).
- Labels show the noun and the resolved amount: "1 serving (250 ml)", "0.5 serving (125 ml)", "Whole package (1.5 L)", "1 can (330 ml)". Large values may display in L or kg; stored values stay in Base units (S§G5).
- Container nouns render from the keys decided in 03, with PACKAGE as fallback. English only, from semantic keys, with no i18n layer built (S§G6, G7).
- The calorie and macro preview updates live as the portion changes (story 29).
- The submitted Portion choice is consistent with the amount by construction (06 validates).

**Out of scope.** Plausibility (09); integrating the options module into editing (08).

**Blocked by.** 06 (transitively 03's container keys and 05's resolver contract).

**Spec requirements / acceptance criteria.** S§G1–G7, S§K3 (client side), stories 16–29 and 47 (the options half); fixtures 3, 4, 18 (client half).
- [ ] Each scenario A–E has the specified default, including nothing preselected for D.
- [ ] Scenario A saves as `PACKAGE × 1`.
- [ ] Quick options appear exactly as specified for each scenario.
- [ ] Every option label shows its resolved amount.
- [ ] An unmapped shape reads "package"; a raw OFF tag never appears.
- [ ] The container noun never changes defaults or options.
- [ ] The options module takes a resolver result (and optionally a stored choice), so edit can reuse it unchanged.

**Implementation areas.** The pure portion-options module and selector component in the frontend; the FoodLog page's pending-item flow.

**Required tests.** Frontend seam (node:test with Vite SSR and static render):
- options and defaults for every scenario;
- labels and the container fallback;
- consistency of the submitted choice;
- at least one MASS and one VOLUME **serialized resolver-result fixture** from 05's contract, so the defaults are proven on the real response shape.

**Edge cases.** Package equal to serving only after normalization (0.33 L vs 330 ml) is Scenario A; a discarded serving makes the product Scenario D; 0.5 serving of 125.5 g displays as 62.8 g.

**Definition of Done.** Shared DoD.

---

## 08 — Edit entries safely and show units in history

**Goal.** Editing an entry offers the same portion options as creating it, follows the historical-authority rules, the Not-scalable edit split and the legacy compatibility exception, and history shows every entry's amount with its unit.

**Why it exists.** S§K5–K9, S§I2 and story 47 define update behaviour that is distinct from create. Getting it wrong would either rewrite history silently or regress edit paths that work today.

**Scope.**
- The update request carries amount, unit and Portion choice under decision #2 (01). 04's validator and the S§K3 consistency check apply exactly as on create (wiring and transport tests here).
- **Same options on edit** (story 47): the edit view uses 07's options module, so a resolvable product offers the same quick options, labels and custom input as on create.
- **Historical authority** (S§K5):
  - the stored amount is authoritative;
  - the stored Portion choice is re-resolved against current metadata **for presentation only**;
  - if it no longer resolves to the stored amount, the entry is presented and edited as CUSTOM, and the stored amount is never mutated;
  - entries with a null Portion choice (backfilled) present as custom.
- **Entry whose product is now Not scalable** (S§K6): a meal-category change proceeds without recalculating; an amount change is blocked with a clear, specific reason. No historical-ratio calculation path is added.
- **Legacy compatibility exception** (S§K7): historical `OPEN_FOOD_FACTS` entries keep their existing edit path, including live OFF re-resolution, outside the new safety enforcement. Document in code that this is legacy compatibility, not an endorsement of the old semantics; new entries cannot use it.
- **Orphaned `PACKAGED_PRODUCT` entries** (S§K8) keep their existing uneditable behaviour. The meal-category-without-recalculation change must **not** incidentally make orphans editable.
- Safety on update for resolvable products (S§I2).
- Replaces 06's transitional ML guard: ML entries become fully editable under these rules. History and edit views show amount with unit; G entries show grams as today (S§K9).

**Out of scope.** Fixing the legacy OFF refresh (deferred); fixing orphan editing (deferred); the historical-ratio path (deferred); plausibility on edit (09).

**Blocked by.** 07 (transitively 04, 05, 06).

**Spec requirements / acceptance criteria.** S§H (update wiring), S§I2, S§K3 (update), S§K5–K9, story 47; fixtures 19, 20, 21, 22 and 24 (presentation half).
- [ ] Editing a barcode-logged entry offers the same valid options as creating it.
- [ ] After a product's serving changes from 250 to 300 ml, a stored `250 ml / SERVING × 1` entry keeps 250 ml and presents as CUSTOM.
- [ ] A Not-scalable product's entry: meal-category change succeeds; amount change is rejected with its reason.
- [ ] The existing legacy OFF edit test's behavioural assertions remain unchanged (fixtures may gain the additive fields).
- [ ] An orphaned entry is still uneditable, including for meal category.
- [ ] History renders "330 ml" for an ML entry and "150 g" for a G entry.
- [ ] Technically invalid or inconsistent updates are rejected exactly as on create.

**Implementation areas.** The update-log DTO; FoodService update path; the FoodLog page's edit and history rendering; the frontend food service.

**Required tests.**
- DTO / global-pipe tests for the update transport.
- Food-service seam for each rule above (prior art: the food-log edit/delete spec, which already covers the legacy OFF edit).
- Frontend seam for edit options and history rendering with units.

**Edge cases.** An edit that changes only the meal category on an ML entry; an edit that submits an unchanged amount; a backfilled entry with a null Portion choice.

**Definition of Done.** Shared DoD. The e2e edit/delete suite is updated and run locally.

---

## 09 — Plausibility advisory on create and edit

**Goal.** Unusually large amounts get one confirmation, never a rejection.

**Why it exists.** It catches order-of-magnitude slips (330 → 3300) without nagging ordinary multi-pack consumption (S§J).

**Scope.**
- Decision tree (S§J1):
  1. Package known: advise only when `amount > 3 × packageSize` (strictly greater).
  2. Otherwise, if a valid Daily calorie target exists: advise only when `entryCalories > dailyCalorieTarget` (strictly greater).
  3. Otherwise: none.
- Serving never triggers an advisory. "≈ N servings" may still be shown as information (S§J2).
- One confirmation. When both apply, the package comparison leads, with calories as context (S§J3). The existing native confirmation convention may be reused.
- Continuing saves. No "confirmed" flag is sent, and the server never rejects for plausibility (S§J4, S§I3).
- The Daily calorie target comes from existing client-side calorie-balance or user data. No fallback target is invented without a baseline (S§J4).
- Applies on edit as on create (S§J5).
- Optional diagnostic logging of warned cases, without unnecessary user context, and never as authorization logic (S§J6).

**Out of scope.** Any server-side ceiling; serving-relative thresholds; per-shape multipliers.

**Blocked by.** 08 (transitively 07).

**Spec requirements / acceptance criteria.** S§J1–J6, R§5.13–5.14, story 47 (confirmation half); fixture 25.
- [ ] 330 ml package: 330, 660 and 990 ml give no advisory; 1000 and 3300 ml give an advisory.
- [ ] No package, with a target: exactly 100% gives none; above 100% gives an advisory.
- [ ] No package and no target: none.
- [ ] Serving-only product at 10 servings: none.
- [ ] Both signals: exactly one confirmation, package-led.
- [ ] Continuing after the confirmation saves the entry.
- [ ] The same rules apply when editing.

**Implementation areas.** A pure plausibility module in the frontend; the save and edit handlers on the FoodLog page; the frontend calorie-balance/user services.

**Required tests.** Frontend seam: the full decision-tree table above, and the single-confirmation behaviour.

**Edge cases.** A missing baseline; a legacy entry being edited with no package (falls to the calorie check); a product with a discarded serving and a package.

**Definition of Done.** Shared DoD.

---

## 10 — Identified-but-not-cataloguable barcodes

**Goal.** When Open Food Facts knows a barcode but has no usable calories, the user sees "identified, no usable nutrition data" with the product's identity instead of "not found". The app remembers the identification without re-querying on every scan.

**Why it exists.** S§E3, F1–F4, F3a and F6 (identified subject kind), with the Packaged product non-null calorie invariant preserved (ADR 0004).

**Scope.**
- OFF client three-way outcome: found with nutrition, **found without usable calories**, not found. Outage handling is unchanged.
- A new lightweight **identification model**:
  - fields: barcode (unique), display name, brand, image, reason (one v1 value, `NUTRITION_MISSING`), source, last provider check;
  - its name is decided here;
  - it is structurally unable to reach the calculator, and it is **not** a general unloggable-product table (S§F2).
- Resolution order (S§F3): Packaged product, then identification record, then providers, then not found or unavailable.
- **Retry policy:** introduce the single named, configurable 30-day policy (S§F4, R§3.4); 11 reuses it.
  - An identification record is re-checked only after its window has elapsed.
  - The provider outcome is classified as a **completed check** or a **transient provider failure**, reusing the client's existing boundary: "temporarily unavailable" is transient, and every answered outcome is completed. This is a shared helper that 11 reuses.
  - **Completed check** (found but still no usable calories, or not found): advance the last-provider-check timestamp; the record is kept.
  - **Transient provider failure** (timeout, network/connection failure, outage, HTTP 5xx, equivalent): **do not** advance the timestamp. Return the existing identification result unchanged and write nothing. The scan does not fail.
- **Implementation-time decision #4 (decide here, before retry code):** the short-lived transient-error backoff (R§3.4, register §9.4).
  - Decide whether repeated provider calls during an outage need limiting at all; if so, choose the mechanism and duration, with evidence.
  - The repository has no existing provider backoff convention. The only cooldown in the codebase is the auth OTP resend, which is unrelated.
  - Whatever is chosen, it is separate from, and never reuses or advances, the 30-day completed-check timestamp.
  - Record it in register §9.4. 11 reuses it.
- **Atomic supersession** (S§F3a): a re-check that now finds calories creates the Packaged product **and removes** the identification record in **one transaction**. That includes the unique-constraint race path, where another writer created the product first. If either step fails, neither persists.
- The `NOT_LOGGABLE` outcome with the **identified-but-not-cataloguable subject kind** and `NUTRITION_MISSING`, kept semantically distinct from not found in state and API shape. It follows decision #2 (01), so older frontends are not broken (S§F6).
- **Frontend:** a distinct "identified, no usable nutrition data" state showing name, brand and image, offering manual search and add product. Not-found handling is unchanged.

**Out of scope.** Pre-filling add product from the record, and removal on user submission (12); re-hydration of Packaged products (11).

**Blocked by.** 05 (transitively 01, 03).

**Spec requirements / acceptance criteria.** S§E3, S§F1–F4, S§F3a (re-check half), S§F6, S§M3; fixtures 12 and 15.
- [ ] A found-without-calories fixture creates an identification record — never a Packaged product, and never zero calories.
- [ ] The outcome is `NOT_LOGGABLE`, identified subject kind, `NUTRITION_MISSING`, and is distinguishable from not found by state, not just by message.
- [ ] No provider call inside the 30-day window; exactly one after it.
- [ ] A successful provider response that still has no usable calories advances the 30-day check timestamp and keeps the record.
- [ ] A not-found response on re-check is a completed check: the timestamp advances.
- [ ] A provider timeout, network failure or 5xx during an eligible re-check does **not** advance the 30-day timestamp.
- [ ] After such a transient failure, the identification result returned and the stored record are unchanged, and the scan does not fail.
- [ ] Decision #4 is recorded in register §9.4 with evidence. If a backoff is implemented, it is tested independently of the 30-day timestamp.
- [ ] A successful re-check with calories yields a Packaged product and no remaining record.
- [ ] A failure in either half of the supersession leaves neither change, as shown by a rollback test.
- [ ] A genuinely unknown barcode still gives not found; an outage still gives unavailable.

**Implementation areas.** OpenFoodFactsClient and the provider-lookup result; ProductResolverService; PackagedProductService; the new identification model; FoodService barcode lookup; the FoodLog page's scan-result states.

**Required tests.**
- OFF-client seam for the three-way outcome.
- ProductResolverService seam, with a controllable clock, for resolution order, the retry window and supersession including rollback. Separate cases for:
  - completed check, still no calories → timestamp advanced;
  - completed not-found → timestamp advanced;
  - timeout → timestamp **not** advanced;
  - network failure → timestamp **not** advanced;
  - HTTP 5xx → timestamp **not** advanced;
  - each transient case → returned result and stored record unchanged.
- The classification helper tested against every client outcome.
- Frontend seam for the distinct state.

**Edge cases.** A barcode that has both a Packaged product and a stale record: the product wins, and the record is never consulted. A 200 response whose body cannot be parsed is reported by today's client as unavailable, so it is transient. A persistent outage must not start the 30-day window, however many scans occur; limiting those calls is decision #4's job.

**Definition of Done.** Shared DoD, the model name recorded, and decision #4 recorded.

---

## 11 — Lazy re-hydration of Open Food Facts products with insufficient portion metadata

**Goal.** A cached OFF product whose Portion dimension is UNKNOWN recovers portion metadata from Open Food Facts on a later scan, at most once per 30 days. Products with any usable portion shortcut never cause a provider call.

**Why it exists.** ADR 0005 as aligned with S§F5: heal genuinely broken records without eroding local-first lookup.

**Scope.**
- **Trigger** (S§F5): an `OPEN_FOOD_FACTS` Packaged product whose Portion dimension is UNKNOWN (no usable package **and** no usable serving), with its retry window elapsed.
  - A missing optional shortcut never triggers.
  - A discarded serving with a usable package never triggers.
- **Write:**
  - fill only portion fields that are absent or unusable (package, serving, container key);
  - never replace a usable value;
  - never write nutrition;
  - never touch `USER_SUBMITTED` or `VERIFIED` rows.
- Additive schema: the last-provider-check timestamp on Packaged product. Uses 10's retry policy, completed/transient classification helper and decision #4 backoff (if any).
- **Completed check** (the provider answered, even with still-unusable portion metadata or not found): advance the last-provider-check timestamp. If the answer contains usable data for a gap, additionally fill the permitted portion gaps.
- **Transient provider failure** (timeout, network/connection failure, outage, HTTP 5xx, equivalent):
  - the timestamp is **not** advanced;
  - no product, portion or nutrition field changes;
  - the cached product is returned as the lookup result;
  - the scan does not fail.

**Out of scope.** Any nutrition refresh (ADR 0005); recovering servings lost to the old regex for products whose package is usable (a documented consequence, S further notes).

**Blocked by.** 10 (transitively 03, 05).

**Spec requirements / acceptance criteria.** ADR 0005, S§F4, S§F5; fixtures 14 and 14a.
- [ ] No usable package or serving: the provider is re-queried.
- [ ] Usable package, no serving: no provider call.
- [ ] Usable serving, no package: no provider call.
- [ ] Discarded serving with a usable package: no provider call.
- [ ] Only gaps are filled; usable values and nutrition are never overwritten; USER_SUBMITTED and VERIFIED rows are skipped.
- [ ] After a completed check, no retry inside 30 days, and a retry after 30 days.
- [ ] A successful provider response that still has no usable portion metadata advances the 30-day check timestamp and writes no portion or nutrition field.
- [ ] A successful response with usable portion data fills the gaps and advances the timestamp.
- [ ] A provider timeout, network failure or 5xx does **not** advance the 30-day timestamp.
- [ ] After such a transient failure, the cached product is returned with every field unchanged, and the scan does not fail.

**Implementation areas.** ProductResolverService (the local-hit short circuit); PackagedProductService (the gap-fill write); Packaged product model.

**Required tests.**
- At the ProductResolverService seam, with a controllable clock and fixture sequences, with separate cases for:
  - completed, still no usable portion metadata → timestamp advanced, nothing else written;
  - completed with usable data → gaps filled, timestamp advanced;
  - timeout → timestamp **not** advanced, product unchanged;
  - network failure → timestamp **not** advanced, product unchanged;
  - HTTP 5xx → timestamp **not** advanced, product unchanged.
- PackagedProductService tests for the gap-fill write and the skip rules.

**Edge cases.**
- The re-fetched data has a serving in a different dimension: captured, then discarded at resolution.
- The product becomes loggable immediately after re-hydration in the same scan.
- An OFF product that has been removed from OFF (404 on re-check) is a completed check: the timestamp advances and the cached row is untouched.

**Definition of Done.** Shared DoD.

---

## 12 — User-submitted products require a Declared nutrition basis

**Goal.** A user adding a product must state whether its label is per 100 g or per 100 ml. A submission that would be Not scalable on arrival is refused with an explanation. Adding a product the app already identified starts from its known name and brand.

**Why it exists.** S§L1–L5, L7, L8 and R§3.9–3.10: nutrition numbers without their denominator are incomplete, and the catalog must never gain a product that is unusable from the start.

**Scope.**
- A required Declared basis (PER_100_G or PER_100_ML) in the submission contract and on the Add Product form (S§L1). The contract change follows decision #2 (01), so an older deployed form is not broken.
- **Package and serving** (S§L2):
  - each is optional and independent;
  - units are normalized with 03's shared normalizer and written to the normalized columns (this migrates the last free-text unit writer);
  - the user is never forced to invent a serving.
- **Ambiguous or unsupported units** typed by the user (bare oz, "portion", unrecognised text) normalize to **absent**, as S§D1–D2 and R§1.4 require. The form may show a non-blocking note that the unit wasn't recognised. It is not a rejection and needs no confirmation.
- **Creation-time scalability** (S§L3):
  - reject a missing basis;
  - reject a basis contradicting the product's own Portion dimension (per 100 g for an ml package).

  A serving-versus-package conflict is **not** a creation error; it is discarded at resolution (S§L4).
- No package and no serving with a Declared basis is valid, and is Scenario E when logged (S§L5).
- The 409 on a duplicate Packaged-product barcode is unchanged (S§L7).
- Starting Add Product from an identified-but-not-cataloguable result pre-fills barcode, name and brand; nutrition and basis stay user-supplied.
- **Atomic removal** (S§L7, F3a): creating the Packaged product and removing the identification record happen in **one transaction**, including the unique-race path. If either fails, neither persists.
- No editing of existing shared products (S§L8).

**Out of scope.** OCR basis suggestion (13); product drafts (deferred).

**Blocked by.** 06 (a created product flows straight into logging, which must be unit-aware), 10 (transitively 05).

**Spec requirements / acceptance criteria.** S§L1–L5, L7, L8, S§F3a (submission half), S§D, S§M3; fixtures 10 (creation half) and 15a.
- [ ] A submission without a basis is rejected with a clear reason.
- [ ] Per 100 g with a 330 ml package is rejected as a basis/dimension conflict.
- [ ] A 330 ml package with a 30 g serving and a PER_100_ML basis is accepted; the serving is later discarded at resolution.
- [ ] Declared PER_100_ML with no package or serving is accepted and resolves as loggable Scenario E.
- [ ] 1.5 L entered by the user is stored as 1500 ml in the normalized columns.
- [ ] A bare "oz" package unit is stored as absent, and the submission otherwise proceeds.
- [ ] Add product from an identified barcode is pre-filled; after creation, no identification record remains for that barcode.
- [ ] A failure in either half of creation/removal leaves neither change, as shown by a rollback test.
- [ ] The duplicate-barcode 409 is unchanged.

**Implementation areas.** The create-packaged-product DTO; PackagedProductService user submission; AddProductForm; the FoodLog page's hand-off into Add Product.

**Required tests.** DTO/service tests (prior art: the create-packaged-product DTO spec and the packaged-product service spec), including the transaction rollback. Frontend seam: the form requires a basis, and pre-fill works.

**Edge cases.** Decimals; a submission racing a provider re-check that creates the same barcode (the transactional unique-race handling applies).

**Definition of Done.** Shared DoD.

---

## 13 — Nutrition-label extraction may suggest a basis, never guess it

**Goal.** The nutrition-label extraction contract can carry a Declared-basis suggestion, which is used only when confident. Otherwise the user must pick the basis, and the user's choice is final.

**Why it exists.** S§L6: OCR must never guess the denominator. The extraction service is a stub that always reports itself unavailable today. This ticket fixes the contract and the form behaviour, so that a real provider added later cannot bypass the rule.

**Scope.**
- Add an optional basis suggestion, with an explicit confident/not-confident signal, to the extraction result.
- The form pre-selects the basis only when a suggestion is present and confident. Otherwise it leaves the basis unselected and requires the user to choose. A user's selection always overrides a suggestion.
- The stub keeps returning unavailable.

**Out of scope.** Wiring a real OCR provider (deferred).

**Blocked by.** 12.

**Spec requirements / acceptance criteria.** S§L6, S stories 59–60.
- [ ] A confident suggestion pre-selects the basis.
- [ ] A missing or unconfident suggestion leaves the basis unselected, and creation requires a choice.
- [ ] The user can change a pre-selected basis, and their choice is what is submitted.
- [ ] The stub's unavailable behaviour is unchanged.

**Implementation areas.** NutritionLabelExtractionService result type; AddProductForm (the OCR candidate-to-form mapping).

**Required tests.** Frontend seam with a mocked extraction response for each case; a backend test that the stub contract is unchanged.

**Edge cases.** A suggestion that contradicts the package dimension entered: the creation-time rule (12) rejects it on submit.

**Definition of Done.** Shared DoD.

---

## 14 — Contract: retire `grams` and the free-text unit columns

**Goal.** Remove the legacy representations once every reader and writer has moved and every environment's backfill is verified.

**Why it exists.** It is the *contract* step of S§M1 step 4. ADR 0006 retires `grams` precisely so that a column named `grams` never holds millilitres.

**Scope.**
- **Pre-flight gates, in the target environment:**
  - 02's verify passes, covering historical G rows and ML rows under decision #2's representation;
  - 03's product-unit verify passes;
  - both verifies have completed and their evidence is archived before any column is removed.

  The ticket does not proceed otherwise.
- **Reference scan:** after preparing the contract code changes and before the schema push, a repository reference scan confirms that no runtime reader or writer still accesses the retired columns. Two things may stay:
  - legitimate external input strings (OFF's `quantity` text, form fields normalized before storage);
  - explicitly identified backfill/verification tools from 02 and 03, which may keep their legacy reads for pre-contract verification. They are documented as unable to run against the contracted schema.
- **Pre-contract snapshot:** export each entry's id, amount, unit and computed nutrition, and archive it.
- Tighten `amount` and `amountUnit` to non-null. Remove `grams` from the schema, DTOs, responses and frontend types. Remove the old free-text package and serving unit columns. Remove the transitional compatibility path chosen in 01, once the frontend has shipped.
- Apply with `db push`. Dropping the verified legacy columns is the one acknowledged data-removal push in this plan, and needs the owner's explicit approval.
- **Post-contract comparison** of `amount`, `amountUnit` and computed nutrition against the archived snapshot.

**Out of scope.** Anything else.

**Blocked by.** 02 and 03 (verification gates), 08 (last `grams` reader/writer on the log side), 12 (last free-text unit writer). Transitively 01 and 04–07, 10.

**Spec requirements / acceptance criteria.** S§M1 step 4, S§M2, S§M3 (removal of the transition), ADR 0006.
- [ ] Both verifies and the reference scan pass before the push.
- [ ] The snapshot is archived before the push.
- [ ] The post-contract comparison shows every entry's amount, unit and nutrition unchanged.
- [ ] No runtime code reads or writes the retired columns; any retained migration tooling is explicitly marked as pre-contract only.
- [ ] The compatibility mechanism is removed.

**Implementation areas.** FoodLogEntry and Packaged product models; log DTOs; response serialization; the product serializer; frontend food-service and product types.

**Required tests.** The full backend and frontend suites; e2e run locally; the snapshot/compare procedure on the configured database.

**Edge cases.** An environment where 02 or 03 never ran: the gate blocks it.

**Definition of Done.** Shared DoD, plus the gate evidence, the snapshot and the owner's push approval attached to the ticket.

---

## Coverage check

| Spec requirement | Ticket(s) |
|---|---|
| A vocabulary | all |
| B1 per-100-Base-units | 03 (schema comment), 06 |
| B2 arithmetic unchanged | 06 |
| B3 Effective basis + provenance, inferred not persisted | 05 |
| B4 OFF rule, legacy grandfathering rule, no ADMIN/future inference | 05 |
| B5 safety invariant | 05 (evaluation), 06 (create), 08 (update) |
| B6 `nutrition_data_per` ignored | 03, 05 |
| C1–C3 dimension, serving discard, conflict | 05 |
| C4 non-barcode sources MASS | 01, 06 |
| D1–D5 normalization | 03 (OFF, import, shared normalizer), 12 (user) |
| E1, E2, E4, E5 OFF mapping | 03 |
| E3 three-way outcome | 10 |
| F1–F4 invariant, identification record, order, retry | 10 (11 reuses the policy) |
| F4 completed check vs transient failure; transient-error backoff (decision #4) | 10 (defines), 11 (reuses) |
| F3a single source of truth (atomic) | 10 (re-check), 12 (submission) |
| F5 re-hydration | 11 |
| F6 outcome contract | 05 (Packaged-product subject), 10 (identified subject) |
| F7 provenance not badged | 05, 06 |
| G1–G7 selector, defaults A–E, container nouns, language | 07 (03 fixes keys) |
| G8 basis line | 06 |
| H1–H5 technical validation | 04 (validator), 06 (create wiring), 08 (update wiring) |
| I1–I3 safety enforcement | 06, 08 |
| J1–J6 plausibility | 09 |
| K1 schema | 01 |
| K2 backfill | 02 |
| K3 portion-choice consistency | 06, 07, 08 |
| K4 retire new OFF entries; no grams fallback | 06 |
| K5–K8 edit rules, legacy exception, orphans | 08 |
| K9 history units | 06 (transitional ML guard), 08 |
| L1–L5, L7, L8 user submission | 12 |
| L6 OCR basis | 13 |
| M1–M3 staged rollout, compatibility | 01, 02, 03, 05, 06, 08, 10, 12, 14 |
| M4 version bump | every ticket (shared DoD) |
| Story 47 same options and confirmation on edit | 07 (module), 08 (options), 09 (confirmation) |
| Fixtures 1–7, 11, 13, 15b | 05 (3 and 4 also 07) |
| Fixtures 8, 9 | 03 |
| Fixture 10 | 12 (creation), 05 (pre-existing row) |
| Fixtures 12, 15 | 10 |
| Fixtures 14, 14a | 11 |
| Fixture 15a | 12 |
| Fixtures 16, 17, 23, 26 | 06 |
| Fixture 18 | 06 (server), 07 (client) |
| Fixtures 19–22 | 08 |
| Fixture 24 | 02 (backfill), 08 (presentation) |
| Fixture 25 | 09 |

**Uncovered requirements:** none.

**Explicitly deferred — not ticketed** (S Out of Scope):
- the legacy `OPEN_FOOD_FACTS` edit refresh (08 preserves it as a documented exception);
- orphaned-entry editing (08 preserves it);
- the historical-ratio edit path;
- user completion or correction of shared product metadata;
- a nutrition-refresh policy;
- a UI localization layer;
- product drafts;
- a real OCR provider;
- COUNT as a dimension;
- density conversion;
- changes to the manual, USDA, canonical, local or voice flows beyond an explicit G unit;
- serving-relative warnings, per-shape thresholds and any server-side consumption ceiling;
- 1.5-serving and package-multiplier quick buttons;
- recovering servings lost to the old regex on products with a usable package (a documented consequence of F5).

## Owner decisions (resolved 2026-09-21)

1. **Provider errors — MODIFIED.** Only a *completed* provider check (the provider answered, but the missing usable data is still missing or unusable, or the product is not found) advances the 30-day timestamp. A transient provider failure (timeout, network/connection failure, outage, 5xx, equivalent) is not a completed check:
   - it does not advance the timestamp;
   - it preserves the cached product or identification result;
   - it mutates no metadata.

   Data-freshness retry and transient-error backoff are separate concerns. The backoff, if needed, is implementation-time decision #4 (register §9.4), owned by 10 and reused by 11. Recorded in R§3.4, ADR 0005, S§F4/F5, story 65 and fixtures 14a and 15. Applied in 10 and 11.
2. **The transitional ML guard — ACCEPTED** as specified in 06. It is a **deployment-transition safety mechanism only, not a product or domain rule**, and 08 removes it in favour of finalized unit-aware editing. Until 08:
   - ML entries may be created safely;
   - history renders their actual amount and ML unit;
   - meal-category-only edits proceed for non-orphaned entries without recalculation;
   - amount edits on ML entries are refused with a clear reason;
   - no path reinterprets or rewrites an ML amount as grams;
   - orphaned `PACKAGED_PRODUCT` entries stay uneditable. It is a temporary restriction to keep S§M3/K9 intact, not a product rule, and 08 removes it.

## Review history

- **Draft (13 tickets).** Produced by `/to-tickets`.
- **Codex review, round 1** (read-only). Found a 04/05 deployment window, a 06/07 inversion against story 47, a `--accept-data-loss` contradiction in ticket 13, non-atomic supersession, ambiguous retry-on-error, undefined verify semantics, and coverage gaps.
- **Round 2.** Codex conceded the disputed points:
  - the 04/05 window is not a regression (severity lowered to MAJOR, fixed by a release batch);
  - 13 must also wait on user submission;
  - per-ticket version bumps are kept;
  - no file paths in tickets;
  - ambiguous user units stay absent per S§D1.

  Claude accepted Codex's remaining corrections: the create→edit ML window (the transitional guard in 06), 12 blocked on 06, the import-script writer moved into 03, a verifier compatible with ML rows, the source hierarchy preserved, and user submission added to compatibility coverage.
- **Round 3** (final confirmation). All six round-2 changes were confirmed applied, with no cycles or inversions. Three wording defects were fixed:
  - 06's meal-only edit keeps orphans uneditable and never recalculates;
  - 14's reference scan exempts the pre-contract verification tools;
  - 11's timestamp wording no longer reads as forbidding gap fills.

  Codex: "No further restructuring is required."
- **Owner decisions (2026-09-21).**
  - Decision 1 was modified: completed checks versus transient failures. Applied to R§3.4, ADR 0005, spec story 65, F4, F5 and fixtures 14a and 15, and to tickets 10 and 11. New implementation-time decision #4 (the backoff) is owned by 10.
  - Decision 2 (the transitional ML guard in 06) was accepted.
  - Register §9 was created to hold all four implementation-time decisions.
- **Old → new numbering:** 01→01, 02→02, 03→03, *(new)*→04, 04→05, 05→06, 07→07, 06→08, 08→09, 09→10, 10→11, 11→12, 12→13, 13→14.
