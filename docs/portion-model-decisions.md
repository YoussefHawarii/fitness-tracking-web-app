# Decision register: unit-aware portion logging for barcode products

Settled decisions from the `grill-with-docs` session. Vocabulary lives in
`CONTEXT.md`; the irreversible calls get their own ADRs. This file exists so
`to-spec` inherits the decisions and the reasoning behind them. It is not a
spec: no field names, endpoints, or components are fixed here.

Evidence behind the Open Food Facts decisions: `off-nutrition-basis-evidence.md`.
The irreversible calls are ADR 0005 (re-hydration policy), ADR 0006 (per-100
base units), and ADR 0007 (inferred basis for Open Food Facts).

## 1. Model

1.1 Nutrition values are per 100 **Base units** — 100 g for a MASS product,
100 ml for a VOLUME product. The stored numbers do not change; what was missing
was the label on them.

1.2 A consumed amount is stored as an explicit amount **plus its unit**,
replacing the single `grams` column. Legacy rows backfill to grams. (ADR 0006)

1.3 A log entry also records the **Portion choice** (whole package / servings /
custom, with its multiplier) alongside the resolved Consumed amount, so an
entry can be displayed and re-edited in the terms the user used.

1.4 Units are normalized to Base units at ingestion — kg to g, L/cl/dl to ml.
`fl oz` is VOLUME; bare `oz` is never assumed to be either dimension. Anything
unconvertible is treated as **absent metadata**, never guessed.

1.5 The Portion dimension concept belongs to any food source, with
CANONICAL/LOCAL/USDA fixed at MASS — no behaviour change for the manual, USDA,
or voice flows.

1.6 COUNT is not a dimension. "1 can", "1 bar", "1 package" are display nouns
over an amount that is always MASS or VOLUME.

1.7 A user cannot correct a shared product's metadata in v1; they log the
amount they actually consumed. Provenance stays per-product, not per-field. A
reviewable completion path is a possible future feature.

## 2. Dimension and basis resolution

2.1 Portion dimension precedence: usable package unit, else usable serving
unit, else a Declared nutrition basis, else UNKNOWN. UNKNOWN is never resolved
to grams for compatibility.

2.2 Package metadata is authoritative over conflicting serving metadata, for
both the dimension and the quantities (including serving greater than package).
The serving is discarded as a shortcut; the coherent package and custom paths
remain. This fires often — 14-19% of products in volume categories.

2.3 A Declared nutrition basis comes only from a source that states it
unambiguously. Open Food Facts' `nutrition_data_per` never qualifies: it is not
read as a Declared basis, not used as conflict evidence, and not shown as
authoritative.

2.4 Open Food Facts products get a provider-scoped **Inferred** basis —
dimension MASS gives PER_100_G, VOLUME gives PER_100_ML, UNKNOWN gives none.
Explicitly not a universal domain rule; another provider may warrant no
inference at all. (ADR 0007)

2.5 The Effective nutrition basis is what the calculator reads: Declared if
present, else a permitted Inferred basis, else UNKNOWN.

2.6 **Safety invariant**: a product is scalable only when the Consumed amount's
dimension matches the Effective nutrition basis. MASS with PER_100_G and VOLUME
with PER_100_ML are safe; crossed pairs are not, and are never bridged by
density or by assuming 1 ml = 1 g. An UNKNOWN basis is not scalable.

2.7 A Declared-basis/dimension contradiction makes the product **Not scalable**
— the dimension does not "win", and neither does the basis. Because of 2.3 this
state is unreachable from Open Food Facts, and governs user-submitted and admin
products, where the basis is genuinely declared.

2.8 Safety is evaluated at resolution, so the UI knows immediately, **and**
revalidated server-side on create and update. The client is never trusted for
calorie correctness. Failure reasons are machine-readable and distinct, at
least conceptually: portion dimension unknown, nutrition basis unknown,
dimension/basis conflict, nutrition missing.

## 3. Catalog and provider policy

3.1 `PackagedProduct` is reserved for products with sufficient nutrition to be
scaled safely; its non-null calorie invariant stays intact.

3.2 A barcode that is identified but cannot become a loggable product keeps a
lightweight `IdentifiedBarcode` record — identification, diagnostics, retry
state, and enough to explain itself to the user. The name describes the known
identity without presenting the row as a catalogued product. An identified
product is not automatically a loggable one, and a nutrition-less one is
structurally unable to reach the calculator. Missing nutrients are never
represented as zero, and package or serving metadata never makes such a
product loggable.

3.3 Lazy re-hydration fills gaps only, never overwrites, and never touches
`USER_SUBMITTED` or `VERIFIED` rows. Nutrition refresh is explicitly out of
scope. (ADR 0005)

3.4 A **completed** provider check that still did not yield the missing usable
data is not repeated for 30 days, held as configurable policy rather than
unexplained behaviour.
It is one shared policy; the timestamp lives on whichever persistent subject
owns the provider state (the catalogued product, or the identification record
of 3.2). No separate provider-check-log table exists merely to centralize it.

"Completed" means the provider actually answered — including "found, but still
without usable calories", "found, but still without usable portion metadata",
and "not found". It advances the check timestamp and starts the 30-day window.

A **transient provider failure** — timeout, network or connection failure,
outage, HTTP 5xx, or any equivalent transport/service failure (in today's
client, everything it reports as "temporarily unavailable") — is **not** a
completed check. It does not advance the 30-day timestamp, the existing cached
product or identification result is returned unchanged, and no product,
portion or nutrition metadata is written. Data-freshness retry (this policy)
and transient-error backoff are separate concerns and are never conflated. If
repeated provider calls during an outage need limiting, that is done by a
distinct short-lived backoff mechanism chosen at implementation time (the
repository has no existing provider backoff convention), never by the 30-day
window. (Owner decision, 2026-09-21.)

3.5 The OFF mapping should read the numeric normalized fields
(`product_quantity`, `serving_quantity` and their units) rather than re-parsing
free text, which currently discards servings such as `"1 portion (330 ml)"`.

3.6 `sourceType: OPEN_FOOD_FACTS` is retired for new entries; historical rows
stay readable. A caching failure must never fall back to a grams-only entry.

3.7 Legacy user-submitted rows with no Declared nutrition basis are handled by
their package-unit evidence: a **MASS** package unit grandfathers the basis as
PER_100_G, since the historical grams-oriented form and the product's own
evidence agree; a **VOLUME** package unit does **not**, and a **missing**
package unit does **not** either — both become UNKNOWN and require review.

This deliberately tightens the earlier tentative rule. That the historical
submission form was grams-oriented is useful context, but with no package-unit
evidence it is not enough to assert a product's actual nutrition denominator.
Consequences follow the normal rules rather than being special-cased: such a
row is Not scalable (2.6), and existing entries referencing it keep their
historical values while amount edits are blocked (6.5).

This is a defensive compatibility rule, not a required data transformation —
the configured database holds zero relevant rows, and environment coverage
beyond it is unknown. No backfill is specified here.

3.8 The record in 3.2 is deliberately **not** a general unloggable-product
table. It persists a successful identification that cannot be represented as a
`PackagedProduct` because it fails that model's catalog invariant — in v1,
missing nutrition. States a `PackagedProduct` can already represent, such as
an unknown Portion dimension or a declared-basis conflict, stay **derived**
from the product row, so one barcode never has both a product row and an
identification record describing the same state. The reason is still stored as
a field rather than implied, leaving room for a future cause without making
this record the general answer to every unloggable condition. The concept is
"identified but not catalogueable as a PackagedProduct", not "unloggable
product".

3.9 Basis by source. `OPEN_FOOD_FACTS` may use the provider-specific Inferred
rule (2.4). `USER_SUBMITTED` **requires** a Declared basis established or
confirmed by the user — nutrition values without their denominator are
incomplete nutrition semantics, since "42 kcal, 10.6 g carbs" says nothing
until it is known whether that is per 100 g or per 100 ml. `ADMIN` may supply a
Declared basis. Any future provider must state explicitly whether its basis is
Declared, provider-Inferred, or unavailable; it inherits nothing.

Manual submission therefore requires the user to choose or confirm the basis.
The nutrition-label OCR path may **pre-fill** it only when the label identifies
it with sufficient confidence; where OCR reads the numbers but cannot reliably
tell per 100 g from per 100 ml, it must not guess — the user selects or
confirms, and the user's confirmation is the final authority for a
`USER_SUBMITTED` product.

3.10 A newly created product must not enter the catalog already Not scalable.
In practice that means creation rejects an UNKNOWN Declared basis, and also
rejects a Declared basis that contradicts the product's own Portion dimension
(2.7) — a submission stating per 100 g for a package measured in millilitres is
refused at creation rather than stored as a permanently unusable row. If
incomplete product drafts are ever wanted, they must be modelled separately
rather than by weakening the `PackagedProduct` invariant.

Note the path this opens: because a Declared basis sits at step 3 of the
dimension precedence (2.1), a user-submitted product with **no** package or
serving metadata but a Declared PER_100_ML basis is fully scalable — the user
logs a custom millilitre amount. Since Open Food Facts never supplies a
Declared basis, user submission is the only way that path is reached.

## 4. Portion UX

4.1 Defaults: package equals serving gives **1 package** preselected. Package
greater than serving gives **1 serving**. Serving only gives **1 serving**.
Package only gives **nothing preselected**, with whole-package and custom both
offered and an explicit choice required. Neither, but scalable, gives custom
only, initially empty.

4.2 No size-based heuristics anywhere — no "small package implies single
serving" rule, at any threshold.

4.3 Quick options when a valid serving exists: 0.5, 1, 2 servings; plus whole
package when Package size exists; plus custom. No 1.5 button and no package
multiplier — a UX simplification only: 1.5 servings, 2 packages and 0.5 package
remain valid amounts reachable through custom input.

4.4 Whole package is always an explicit action, except where package equals
serving has already made 1 package the safe default.

4.5 Every option shows the human-friendly label **and** the resolved amount —
"1 serving (250 ml)", "Whole package (1.5 L)" — so the quantity driving the
calculation is never hidden behind a noun.

4.6 The Effective nutrition basis is shown consistently ("42 kcal / 100 ml").
Declared-versus-Inferred provenance is a model and diagnostics concern, not a
user-facing badge. An unsafe product instead says clearly that it cannot be
logged.

4.7 Container nouns come from a small app-owned map over OFF's structured
`packagings[].shape` taxonomy to localized English/Arabic labels, with a
generic "package" fallback. Never inferred from name, brand, barcode, category
or size; never shown raw as `en:drink-can`; presentation only — it never
affects whether a product is treated as single-serving.

4.8 Decimal amounts are accepted to one decimal place for input and display.
Internal nutrition calculation must not be repeatedly rounded to that
precision. Zero and negative amounts are rejected with a specific reason.

4.9 An amount exceeding Package size is **not** a validation failure — the user
may have consumed several packages. Exceeding it merely warrants a
confirmation, and not at every excess: see 5.9 for the threshold.

4.10 Where normalized Package size and Serving size are the same amount
(Scenario A), the persisted Portion choice is **PACKAGE** with multiplier 1 —
the package is the physical object the barcode identifies and gives the most
stable historical representation. Presentation may still read "1 can (330 ml)"
where structured container metadata exists, but the persisted kind stays
PACKAGE. There is no PACKAGE_AND_SERVING kind. A later change to serving
metadata must not reinterpret the historical entry.

4.11 Container vocabulary is normalized to app-owned semantic keys, kept
separate from presentation: `en:drink-can` becomes CAN becomes "can";
`en:bottle` to BOTTLE; `en:jar` to JAR; any unknown or absent shape to PACKAGE.
Raw provider taxonomy values are never persisted or displayed as user-facing
labels. Canonical units stay semantic too (G, ML) rather than embedding
localized display strings in the domain model, so a future localization layer
can map CAN to "can" or "علبة" without touching ingestion or nutrition logic.

## 5. Validation versus plausibility

5.1 Two separate concerns, never conflated. **Calculation safety** is a
server-enforced invariant, because a wrong answer produces a wrong number.
**Plausibility** is advisory UX, because a surprising answer may simply be
true. The server rejects an amount when safe calculation is impossible; it
never rejects an otherwise valid amount for looking large.

5.2 Server-side technical validation rejects values that are non-numeric, NaN,
infinite, zero or negative, more precise than the accepted input precision, or
outside a deliberately chosen transport/storage-safe magnitude. That magnitude
exists for transport, input and storage safety — **not** as a claim about how
much a person can consume. No server-side human-consumption ceiling exists.

The bound is `0 < amount < 1 000 000 000`, exclusive. Justification to record
with the constant: 1e9 is far inside IEEE-754 double exact-integer range
(2^53, about 9e15) so a JSON body round-trips without precision loss, and far
inside `DECIMAL(65,30)`'s ceiling of about 1e35 so no column can overflow. It
must not be named or documented as a consumption maximum — something like
`MAX_SAFE_CONSUMED_AMOUNT_INPUT` rather than `MAX_FOOD_AMOUNT`. The codebase's
existing convention for such limits is a module-level SCREAMING_SNAKE constant
with a comment stating why it exists (`MAX_AVATAR_BYTES`,
`MAX_AUTOMATIC_SCAN_RESTARTS`, `OTP_MAX_ATTEMPTS`). Oversized input must be
rejected cleanly by validation, never left to surface as a database or
internal error.

5.3 Input precision and calculation precision are different things. Amounts are
accepted and displayed to one decimal place; intermediate nutrition
calculations are not repeatedly rounded to that precision.

5.4 Plausibility uses the strongest product-specific reference available:
Package size if it exists, else Serving size if that proves a useful reference,
else optionally the user's existing Daily calorie target. Where no reference
exists, no arbitrary mass or volume constant is invented.

5.5 The Daily calorie target is a secondary advisory signal only. Exceeding it
never invalidates an entry, is never evidence that the amount is wrong, and its
absence never invalidates anything. No fallback target is ever invented.

5.6 When more than one plausibility trigger applies, the user sees **one**
confirmation, not stacked dialogs.

5.7 No client-supplied "confirmed" flag is required to pass plausibility;
client-side confirmation is sufficient, since nothing is being authorized.
Diagnostic logging of warned cases is acceptable but must not become
authorization logic, and must not record unnecessary user context.

5.8 The same plausibility confirmation applies on edit as on create. UPDATE
versus CREATE does not change the concern.

5.9 Plausibility decision tree. If Package size exists: confirm only when
`amount > 3 x packageSize`, strictly greater. So for a 330 ml package, 330,
660 and 990 ml pass silently; 1000 ml (about 3.03 packages) and 3300 ml
confirm. The 3x multiplier is a UX heuristic for reducing confirmation fatigue
while still catching order-of-magnitude slips — not a nutrition invariant, not
a consumption maximum, not a server-side rejection, and not evidence that an
amount is wrong. No per-container-shape variation in v1. Otherwise, if a valid
Daily calorie target exists and the calorie advisory condition is met, use the
calorie-relative advisory. Otherwise, no warning.

5.10 Serving size never triggers a warning on its own. It remains useful for
portion selection, defaults, explaining a resolved amount, and scaling — but it
is a manufacturer's recommendation, not a physical boundary, so a serving
multiplier would need an invented threshold. The UI may still *display*
"300 g is about 10 servings" where that helps; it just does not warn.

5.11 When package-relative and calorie-relative signals both fire, the user
sees one confirmation with the product-relative explanation leading and the
calorie figure as supporting context — the physical reference tells the user
what they may have mistyped, the calorie figure why it matters. Never two
stacked dialogs. The app's only existing confirmation convention is a native
`window.confirm`; no custom dialog component exists to reuse.

5.12 A stored Consumed amount is a historical fact; the stored Portion choice
is presentation metadata. On edit, the choice is re-resolved against current
product metadata **for presentation only**: if it still resolves to the stored
amount, the friendly label may be shown; if it no longer does — because the
product's serving or package metadata has since changed — the stored amount is
preserved and the entry is presented and edited as CUSTOM. The historical
amount is never mutated to keep an old label true.

5.13 Final plausibility hierarchy, in order: (1) a usable Package size exists —
advise only when `amount > 3 x packageSize`; (2) no Package size but a valid
Daily calorie target exists — advise only when `entryCalories >
dailyCalorieTarget`, strictly greater, so exactly 100% does not warn; (3)
neither — no advisory. No 50%, 75% or 150% variant, and no invented fallback
target when `UserBaseline` is absent. Serving size alone never triggers a
warning at any multiple.

5.14 The absence of a plausibility warning never means an amount has been
verified as reasonable, and the presence of one never means the entry is
unsafe: an entry can be perfectly safe to calculate and still warn. All
advisories are client-side confirmations, non-blocking once the user continues,
and wholly separate from the server-enforced safety invariant.

## 6. Pre-existing conditions exposed, not introduced

6.1 Editing a legacy `OPEN_FOOD_FACTS` entry re-resolves live from Open Food
Facts and recomputes from today's provider values, so an edit can silently
change the nutrition an entry was created from. Pre-existing, covered by a
passing test, out of scope here; the principled fix is a separate future
concern.

6.2 Entries whose product row is gone cannot be edited at all — the update path
re-resolves by `sourceRef` and throws "Packaged product not found", blocking
even a meal-category change. Three such rows exist. Pre-existing; not fixed
here.

6.3 Historical amounts meant grams when written and are treated as MASS/g
forever. They are never retroactively reinterpreted as ml from a later lookup.

6.4 No volume-based, conflicting, or metadata-absent OFF fixture exists in the
test suite, so nothing currently guards any of this. Fixture coverage is
required of the eventual tickets, and must be deterministic rather than
depending on live Open Food Facts.

6.5 A pre-existing entry stays historically valid even when its product no
longer satisfies the scalability invariant. It is never retroactively altered
or invalidated. Edits then split by whether they need recalculation: a meal
category change may proceed, an amount change is **blocked** with a clear
stated reason rather than a generic validation failure, because an existing
historical entry is not permission to perform a new unsafe calculation. No
second historical-ratio calculation path is built here.

6.6 There is no UI i18n layer: `languagePreference` currently only selects the
speech-recognition locale, and bilingual UI text exists as ad-hoc `{ en, ar }`
maps in individual components. Product data is language-aware; product labels
are not. Recorded as a **follow-up concern** — this feature ships English
labels behind semantic keys (4.11) and does not build localization.

## 7. Deliberately deferred follow-up concerns

Each is a real problem, deliberately outside this feature's scope:

7.1 Legacy `OPEN_FOOD_FACTS` entry edits silently recompute from current
provider values (6.1). Principled fix: recompute from the entry's own stored
figures.

7.2 Entries whose product row is gone cannot be edited at all (6.2).

7.3 A historical-nutrition-ratio edit path (stored calories over stored amount)
that would let 6.5's blocked amount edits proceed without consulting the
product.

7.4 A reviewable path for a user to complete or correct shared product
metadata (1.7).

7.5 A nutrition-refresh policy, explicitly excluded from ADR 0005.

7.6 A general UI localization layer (6.6).

## 8. Genuinely unresolved

None. The two questions left open when this register was first written are now
settled: the legacy grandfathering rule was tightened and folded into 3.7, and
the requirement for a Declared basis on new user-submitted products is recorded
in 3.9 with its creation-time consequence in 3.10.

Everything still outstanding is a deliberate deferral (section 7) or a naming
and shaping decision that belongs to `to-spec` — field, table, enum and
constant names, API response shape, and migration sequencing were all kept out
of this register on purpose.

## 9. Implementation-time decisions

Decisions whose inputs only exist at build time. They are not deferred feature
work (section 7) and not open design questions (section 8). Each is decided and
recorded here by the ticket named, with its evidence. None may override a
settled requirement above or in the spec; if one would, the owner is asked.

9.1 Final app-owned container keys and the Open Food Facts shape-tag mapping
(spec G6). Decided in ticket 03. **Decided (2026-09-28):**

- *Evidence.* Across 24 recorded single-product responses, the observed shape
  counts were: `en:bottle` 6; `en:bag` 5; `en:drink-can` 4; `en:sleeve` 4;
  `en:bottle-cap` 3; `en:box` 3; `en:can`, `en:envelope` and `en:film` 2 each;
  and `en:Container`, `en:fastener`, `en:individual-bag`, `en:jar`, `en:label`,
  `en:lid`, `en:packet`, `en:pot`, `en:seal` and `en:sheet` 1 each.
- *Keys and mapping.* The closed app-owned key set is `PACKAGE`, `CAN`,
  `BOTTLE`, `JAR`, `BOX`, `BAG`. `en:can` and `en:drink-can` map to `CAN`;
  `en:bottle` to `BOTTLE`; `en:jar` and `en:pot` to `JAR`; `en:box` to `BOX`;
  and `en:bag` and `en:packet` to `BAG`. Matching is case-insensitive, so the
  inconsistent `en:Container` is recognized as generic rather than persisted.
- *Primary-container rule.* Preserve provider order and choose the first
  mapped physical container after ignoring closures and secondary wraps
  (`bottle-cap`, `film`, `sleeve`, `individual-bag`, `envelope`, `lid`, plus
  the observed `fastener`, `label`, `seal` and `sheet`). Unknown and generic
  tags do not mask a later meaningful shape. If nothing maps, use `PACKAGE`.
  These keys are presentation-only and raw tags are never persisted.

9.2 Deployment-compatibility mechanism for the staged food-log rollout,
including the create-path release batch, the transitional representation of ML
entries, and compatibility of the barcode-lookup and product-submission
contracts (spec M3). Decided in ticket 01. **Decided (2026-09-25):**

- *Evidence.* Frontend and backend (separate Vercel projects) deploy independently
  from the same repository, with no committed manifest ordering them
  (AGENTS.md), so one merge can reach either side first. The global
  validation pipe sets `forbidNonWhitelisted: true`: a backend that does not
  yet know a request field rejects the whole request with 400.
- *Mechanism: backend-first, tolerant-reader expand.* Every request-shape
  change lands in two separately deployed steps. First the backend accepts
  **both** the old and the new shape (the new fields are optional, and the
  legacy `grams` field stays accepted and means an amount in G). Only after
  that backend is confirmed live does a later merge switch the frontend to
  send the new shape. A frontend change that sends a new field is never in
  the same merge as the backend change that first accepts it. Responses only
  ever gain fields during the transition, so an older frontend keeps working.
  This applies to the log create/update contracts (tickets 06, 08), the
  barcode-lookup response (05, 10) and the product-submission contract (12).
- *Legacy product submission without a basis.* The deployed Add Product form
  labels every nutrition field per 100 g, so an omitted basis is accepted as
  a user-declared `PER_100_G`. The normal creation-time safety check still
  rejects a volume package as `DIMENSION_BASIS_CONFLICT`; an explicitly
  invalid basis is rejected by request validation. The current form requires
  an explicit basis choice and never defaults the control.
- *Release batch 05 + 06.* Ticket 05's resolver may merge first, but the
  frontend step that lets a user save an ML amount ships only with 06's
  server-side safety enforcement already live. Because the backend always
  deploys first, the server's safety invariant is in force before any client
  can submit ML; a legacy `grams` request against a PER_100_ML product is
  rejected by that invariant (spec M3).
- *Transitional representation of ML entries.* `grams` becomes nullable in
  ticket 01 (relaxing NOT NULL is additive under `db push`). A G entry writes
  `grams = amount`; an ML entry writes `grams = NULL`, so no column named
  `grams` ever holds millilitres (ADR 0006). Every reader uses
  `amount ?? grams`. Ticket 02's verifier therefore checks G rows for
  `amount = grams` and ML rows for `grams IS NULL`, and ticket 14's gate uses
  the same predicates.
- *Transition complete (2026-09-29).* The contract release removed the legacy
  `grams` request/response and storage path, the free-text product-unit
  columns, and the missing-basis default. Food logs now require `amount` with
  `amountUnit`, and product submissions require an explicit Declared basis.

9.3 Whether conservative free-text Open Food Facts size parsing remains as a
fallback beneath the structured numeric fields (spec E1). Decided in ticket 03.
**Decided (2026-09-28):** Do not retain a free-text fallback.

- *Evidence.* All 24 recorded found-product responses had both
  `product_quantity` and `product_quantity_unit` (0/24 incomplete package
  pairs). Five of 24 lacked a complete structured serving pair:
  `serving_quantity` was absent in 5/24 and `serving_quantity_unit` in 4/24.
  None of those five had a free-text `serving_size` that would yield a usable
  value (0/5 recovered). The package free text therefore recovered 0 cases,
  and serving free text recovered 0 cases.
- *Rule.* Only the structured numeric value/unit pairs are normalized. A
  missing or unusable structured pair remains absent. This removes an
  unneeded parsing surface and preserves the no-guessing rule for ambiguous
  or unsupported units. Explicit spelling aliases are accepted only when they
  name the same unit (including common English/French spellings,
  abbreviations, and the recorded Arabic vocabulary); ambiguous tokens such
  as bare `oz` or a lone `fl` remain absent.

9.4 The short-lived transient-provider-error backoff mechanism, if repeated
provider calls during an outage need limiting (3.4) — whether one is needed,
its mechanism and its duration. It must never reuse or advance the 30-day
completed-check timestamp. Decided in ticket 10, and reused by ticket 11.
**Decided (2026-09-28):** Apply a 60-second in-memory backoff per provider and
canonical barcode after a transient failure.

- *Evidence.* Open Food Facts publishes a limit of 15 product-read requests
  per minute per IP and may return HTTP 503 when global limits are exceeded
  (https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/).
  Calls from this backend share its outbound IP. Its 50-request rolling
  five-minute user/IP throttle does not cap the aggregate from different
  authenticated users below OFF's limit, and each failed provider call can
  occupy the existing client timeout for up to 8 seconds. Because transient
  failures deliberately do not advance the 30-day timestamp, repeated scans
  of one stale barcode would otherwise each call the unavailable provider.
- *Mechanism.* Record only an ephemeral failure deadline keyed by provider and
  canonical barcode. Until 60 seconds have elapsed, return the cached
  identification result unchanged; where there is no cached subject, retain
  the existing unavailable outcome. A completed response clears the backoff.
  The state is deliberately per process: it needs no database table or
  distributed cache, and a restart merely loses a short-lived optimization.
- *Separation.* The backoff has its own clock and stores no completed-check
  timestamp. It never writes or advances `lastProviderCheckAt`; after it
  expires, the same 30-day eligibility decision still applies. Ticket 11 uses
  the same mechanism for portion re-hydration.
