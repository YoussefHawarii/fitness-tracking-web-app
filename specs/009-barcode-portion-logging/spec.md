# Spec: Unit-aware portion logging for barcode products

Status: ready for review (pre-`to-tickets`).
Sources of truth: `CONTEXT.md` (Portion model section), `docs/portion-model-decisions.md`
(the decision register, cited below as **R§n.n**), `docs/off-nutrition-basis-evidence.md`,
and ADRs 0004–0007. Where this spec and those documents disagree, the documents win and
this spec is wrong.

---

## Problem Statement

When I scan a packaged product, the app always asks me for **grams** and always shows
nutrition as **"kcal / 100g"** — even for a 330 ml can of soda or a 200 ml juice box. I
have to translate what I drank into a unit that doesn't describe it, and the label on
the nutrition figure is wrong for anything measured by volume.

Worse, the app gives me no help with the portion I actually consumed. It knows the
package holds 330 ml, or that a serving is 30 g, but I still have to type a number from
scratch every time. And nothing stops a slip: typing 3300 for a 330 ml can is logged
silently as ten times what I drank.

The app also misleads me when a barcode is recognised but unusable. If Open Food Facts
knows the product but has no calorie data for it, I'm told "no product found" — about
the bottle in my hand.

Behind this sit several data problems the user never sees but pays for:

- Nutrition values are stored "per 100 g" for every product, including liquids, and
  food log entries record every amount in a column called `grams`, even when the amount
  is millilitres.
- Serving sizes that Open Food Facts supplies numerically are thrown away when they are
  written as free text like "1 portion (330 ml)".
- Nothing distinguishes a product whose nutrition can be scaled safely from one whose
  nutrition denominator is unknown or self-contradictory, so an unsafe product can
  produce a confident-looking but wrong calorie figure.

## Solution

After a barcode resolves, the app shows the product's nutrition in its **own** unit
("42 kcal / 100 ml", "500 kcal / 100 g") and offers portion choices built from the
product's real package and serving metadata — "1 package (330 ml)", "1 serving (250 ml)",
"Whole package (1.5 L)" — always showing the measurable amount behind each label. For
the common case of a single-serving can or bar, the right portion is already selected:
scan, pick a meal, save.

The app never assumes I consumed the whole package unless the package *is* the serving,
and never invents a serving the product doesn't have. I can always type a custom amount,
in the product's own unit, to one decimal place.

Products the app cannot scale safely — unknown measurement semantics, a contradictory
record, or no nutrition at all — are shown as **identified but not loggable**, with a
clear reason and the existing fallbacks (manual search, add product), instead of either
a wrong number or a false "not found".

If I enter an amount that looks unusual — more than three whole packages, or, where no
package size is known, more calories than my entire daily target — the app asks me to
confirm once. It never refuses a technically valid amount merely for being large.

When I add a product myself, I must say whether its label is per 100 g or per 100 ml,
because nutrition numbers without their denominator are incomplete.

Existing log entries keep exactly the values they were recorded with.

---

## User Stories

### Scanning and seeing a product

1. As a user scanning a canned drink, I want its nutrition shown per 100 ml, so that the label matches what is printed on the can.
2. As a user scanning a snack, I want its nutrition shown per 100 g, so that the label matches what is printed on the pack.
3. As a user, I want every portion option to show the actual amount it stands for (e.g. "1 serving (250 ml)"), so that I understand exactly what quantity drives the calorie figure.
4. As a user, I want the package described with a meaningful noun ("1 can (330 ml)") when the product's structured packaging data says it is a can, so that the choice reads naturally.
5. As a user scanning a product whose container type is unknown, I want it described generically as "package", so that the app never guesses a container from the product's name.
6. As a user, I want the product's name, brand and image shown as today, so that I can confirm I scanned the right item.
7. As a user scanning a product that Open Food Facts knows by barcode but that has no calorie data, I want to be told the product was identified but has no usable nutrition data, so that I'm not falsely told the barcode is unknown.
8. As a user shown an identified-but-not-loggable product, I want the existing manual search and add-product fallbacks offered, so that I can still log what I ate.
8a. As a user adding nutrition for a product the app already identified, I want its known name and brand pre-filled, so that I'm not re-typing what the app already knows about a barcode it recognised.
9. As a user scanning a product whose measurement semantics are unknown, I want to be told it can't be logged safely, so that I'm never shown a calorie figure computed from an unknown denominator.
10. As a user scanning a product whose record is internally contradictory about its nutrition denominator, I want it treated as not loggable, so that neither the package nor the label silently "wins".
11. As a user scanning a product whose serving data contradicts its package (e.g. a 500 ml bottle with a "900 g" serving), I want the bad serving silently omitted while package and custom options still work, so that bad provider data doesn't block me or distract me with a warning.
12. As a user scanning an unknown barcode, I want the same "not found" experience as today, so that genuinely unknown products are handled as before.
13. As a user scanning while Open Food Facts is unreachable, I want the same "try again" experience as today, so that an outage isn't mistaken for a missing product.
14. As a user rescanning a product I've scanned before, I want it to behave exactly as it did the first time, so that cached products are consistent.
15. As a user rescanning a cached product, I want it to resolve instantly from the local catalog without contacting Open Food Facts, so that scanning stays fast.

### Choosing a portion (Scenarios A–E)

16. As a user scanning a product whose package and serving are the same amount (e.g. 330 ml / 330 ml), I want "1 package" preselected, so that I can save without typing anything.
17. As a user scanning a multi-serving package (e.g. 1.5 L with a 250 ml serving), I want "1 serving" preselected, so that the app never assumes I drank the whole bottle.
18. As a user scanning a product with a serving size but no package size, I want "1 serving" preselected, so that the common case is one tap.
19. As a user scanning a product with a package size but no serving size, I want nothing preselected and a choice between "Whole package" and a custom amount, so that I must decide rather than accept a default that could log an entire cereal box.
20. As a user scanning a product with neither a package nor a serving size, but whose measurement semantics are known, I want an empty custom-amount field in the product's unit, so that I can still log it.
21. As a user with a valid serving available, I want quick options for 0.5, 1 and 2 servings, so that common portions take one tap.
22. As a user, I want a "Whole package" option whenever the package size is known, so that finishing a pack is one explicit tap.
23. As a user, I want "Whole package" to be something I choose rather than a default (except where package equals serving), so that I'm never silently logged for an entire package.
24. As a user, I want to enter a custom amount in the product's own unit (g or ml), so that I can log exactly what I consumed.
25. As a user, I want to enter decimal amounts like 330.5 ml or 125.5 g, so that I can be precise.
26. As a user who drank one and a half servings, I want to reach that amount through the custom field, so that the simplified quick options don't prevent me from logging it.
27. As a user who drank two cans, I want to log 660 ml through the custom field, so that multiple packages are loggable even without a dedicated button.
28. As a user who changes my mind after a default is preselected, I want to change the amount freely, so that the default is a convenience, not a constraint.
29. As a user, I want the calorie and macro preview to update as I change the portion, so that I see the effect before saving.

### Validation and confirmation

30. As a user entering zero or a negative amount, I want a specific message saying the amount must be greater than zero, so that I know what to fix.
31. As a user entering something that isn't a valid number, I want it rejected clearly, so that malformed input never reaches my log.
32. As a user entering more than one decimal place, I want a clear message about the accepted precision, so that I understand why the value was rejected.
33. As a user entering a wildly oversized number by accident, I want it rejected cleanly by validation rather than causing an error screen, so that the app stays predictable.
34. As a user entering more than three whole packages' worth of a product, I want one confirmation stating the equivalent ("about 4.5 packages"), so that I can catch a mistyped digit.
35. As a user entering two or three packages' worth, I want no confirmation, so that ordinary multi-pack consumption isn't nagged.
36. As a user logging a product with no known package size, I want a confirmation only if the entry alone exceeds my entire daily calorie target, so that I'm warned about genuinely remarkable entries without arbitrary thresholds.
37. As a user who hasn't set up my baseline, I want no calorie-based warning at all, so that the app never invents a target for me.
38. As a user whose entry trips both the package and calorie checks, I want a single confirmation that leads with the package comparison and includes the calorie figure, so that I'm not shown stacked dialogs.
39. As a user who intentionally consumed a large amount, I want to confirm and continue, so that a warning never blocks a true entry.
40. As a user, I want the absence of a warning never to be presented as confirmation that my amount is reasonable, so that I'm not misled.

### Saving and meal logging

41. As a user, I want barcode products to use the existing Breakfast / Lunch / Dinner / Snacks meal flow, so that there is one food log, not two.
42. As a user, I want my entry to record the amount I consumed in its real unit, so that my history says "330 ml" for a drink rather than "330 g".
43. As a user, I want my entry to remember how I chose the portion ("1 can", "2 servings", custom), so that history and editing show it in my terms.
44. As a user logging a package-equals-serving product with the default, I want it recorded as "1 package", so that the entry stays stable even if the product's serving data changes later.
45. As a user, I want calories and macros computed from the amount I actually consumed, so that the numbers reflect reality rather than the package size.
46. As a user, I want nutrition computed only when my amount's unit matches the product's nutrition basis, so that grams are never scaled against a per-100 ml figure or vice versa.

### Editing and history

47. As a user editing a barcode-logged entry, I want the same portion options and the same confirmation rules as when creating it, so that edits are held to the same standard.
48. As a user reopening an older entry, I want it shown with its original portion label when that label still describes the stored amount, so that it reads the way I logged it.
49. As a user reopening an entry whose product's serving or package data has since changed, I want my stored amount kept and the entry shown as a custom amount, so that my history is never silently rewritten.
50. As a user with entries logged before this feature, I want them shown in grams with their original calories, so that nothing I logged changes meaning.
51. As a user editing an older entry whose product can no longer be scaled safely, I want to still be able to change its meal category, so that a non-nutritional edit isn't blocked.
52. As a user trying to change the amount of such an entry, I want a clear explanation of why the amount can't be recalculated, so that I'm not shown a generic error.
53. As a user browsing my history, I want every entry to show its amount with the correct unit, so that my log is readable.

### Adding a product myself

54. As a user adding a product that wasn't found, I want to state whether its nutrition label is per 100 g or per 100 ml, so that the app knows what the numbers mean.
55. As a user adding a product, I want package size and serving size to be independent optional fields, so that I'm never forced to invent a serving the label doesn't show.
56. As a user adding a product, I want to enter package and serving sizes in units like L, kg or cl and have them normalized, so that I can type what's printed on the pack.
57. As a user adding a product whose stated basis contradicts its package (per 100 g for a package in ml), I want the submission refused with an explanation, so that I don't create a product nobody can log.
58. As a user adding a product with no package or serving size but a stated per-100 ml basis, I want it to be loggable by custom millilitre amount, so that incomplete-but-honest labels are still useful.
59. As a user photographing a nutrition label, I want the basis pre-filled only if it could be read confidently, and otherwise to be asked, so that the app never guesses the denominator.
60. As a user, I want my confirmation of the basis to be final for a product I submitted, so that my reading of the physical label is authoritative.

### Catalog, provider and data integrity (maintainer stories)

61. As a maintainer, I want every Packaged product in the catalog to have usable calories, so that the catalog's invariant still guarantees a product can reach the calculator.
62. As a maintainer, I want a barcode that was identified but cannot become a Packaged product to be kept as a lightweight identification record, so that the app can explain it and avoid re-querying the provider on every scan.
63. As a maintainer, I want that record reserved for identifications that fail the catalog invariant, so that the same barcode never has both a product row and a second record describing the same state.
64. As a maintainer, I want a cached product whose portion metadata is too incomplete to resolve safely to recover it lazily from Open Food Facts on a later scan, while a product that merely lacks an optional package or serving shortcut never triggers a provider call, so that recovery heals genuinely broken records without eroding local-first lookup.
65. As a maintainer, I want a completed provider check that still yields no usable data not repeated for 30 days, configurably — while a transient provider outage does not start that window — so that a product Open Food Facts can never complete doesn't cost a provider call on every scan, and a brief outage doesn't block useful recovery for a month.
66. As a maintainer, I want recovery to only fill gaps, never overwrite a usable value, never touch nutrition, and never touch user-submitted or verified products, so that re-hydration can't silently change what users have been logging.
67. As a maintainer, I want the Open Food Facts basis recorded as inferred under a named, documented rule, never as declared, so that future code can tell the two apart.
68. As a maintainer, I want the inference rule scoped to Open Food Facts only, so that a future provider inherits no inference by default.
69. As a maintainer, I want Open Food Facts' `nutrition_data_per` field ignored for basis purposes, so that a contributor-set flag shown to be unreliable can't create false contradictions.
70. As a maintainer, I want units normalized to grams or millilitres at ingestion, with ambiguous units (bare "oz", "portion") treated as absent, so that no unit is ever guessed.
71. As a maintainer, I want the server to re-check nutrition safety on every create and update, so that calorie correctness never depends on the client.
72. As a maintainer, I want machine-readable reasons for every not-loggable outcome, so that the UI and diagnostics can distinguish them.
73. As a maintainer, I want discarded contradictory serving data logged for diagnostics, so that bad provider data can be investigated.
74. As a maintainer, I want new scans always to produce Packaged-product entries rather than legacy Open-Food-Facts entries, so that there is one source of truth for portion and safety data.
75. As a maintainer, I want a caching failure to fail the scan rather than fall back to a grams-only entry, so that a persistence problem can never downgrade nutrition semantics.
76. As a maintainer, I want existing legacy Open-Food-Facts entries to remain readable, so that historical data survives.
77. As a maintainer, I want the manual, USDA, canonical and voice flows to behave exactly as before, so that this feature doesn't regress them.
78. As a maintainer, I want the schema change applied without losing any existing food-log amounts, so that no history is lost under the `db push` workflow.
79. As a maintainer, I want deterministic fixtures for every portion and safety scenario, so that regressions are caught without calling the live Open Food Facts API.

---

## Implementation Decisions

### A. Domain vocabulary (binding)

The spec uses `CONTEXT.md` terms exactly. In summary:

- **Portion dimension** — MASS, VOLUME or UNKNOWN; the dimension package, serving and consumed quantities are expressed in. Not a food/drink classification.
- **Base unit** — grams for MASS, millilitres for VOLUME; every stored quantity is in its Base unit.
- **Package size** — how much the barcoded package contains. Never implies consumption.
- **Serving size** — a reference serving from reliable metadata. Never fabricated.
- **Servings per package** — derived, never stored.
- **Declared nutrition basis** — stated explicitly by a trustworthy source (user, admin, a future provider with a genuine basis field). Never inferred.
- **Inferred nutrition basis** — established by a documented, source-specific rule. Always labelled as inferred.
- **Effective nutrition basis** — Declared if present, else a permitted Inferred basis, else UNKNOWN. The only basis the calculator reads and the one the user sees.
- **Consumed amount** — what the user consumed, in the Base unit; the historical fact.
- **Portion choice** — how the user expressed the amount (PACKAGE / SERVING / CUSTOM + multiplier); presentation metadata only.
- **Not scalable** — resolved, identifiable, but nutrition will not be computed from it.
- **Identified-but-not-cataloguable barcode** — a successful provider identification that cannot become a Packaged product because it fails the catalog invariant (in v1: missing nutrition).
- **Nutrition safety** (server-enforced) vs **plausibility advisory** (client-side confirmation) vs **technical input validation** (server-enforced) — three separate layers, never conflated (R§5.1).

### B. Nutrition semantics

- B1. The existing `*Per100g` nutrition columns on Packaged product are **reinterpreted, not renamed**, as "per 100 Base units" (ADR 0006, R§1.1). No nutrition value changes.
- B2. The calorie calculator's arithmetic (`value × amount / 100`) is unchanged. What changes is that it may only be invoked when the Consumed amount's dimension equals the Effective nutrition basis (B5). There is no conversion between MASS and VOLUME anywhere, no density concept, and no 1 ml = 1 g assumption.
- B3. **Effective nutrition basis resolution**, applied at every resolution:
  1. If the product has a **Declared nutrition basis**, that is the Effective basis.
  2. Else, if a **source-specific inference rule** applies, its result is the Effective basis, labelled Inferred with the rule's identifier.
  3. Else UNKNOWN.
  Only a Declared basis is persisted as such. An Inferred basis is reproduced deterministically at resolution from the product's source and normalized portion data, so v1 has no need to store it — but this is a v1 simplification, **not** an architectural constraint: nothing in the model forbids persisting an inferred basis (with its origin and rule) later if it stops being cheaply reproducible. Whatever the storage choice, the resolution result must always carry the Effective basis, its origin (DECLARED or INFERRED), and — when inferred — the provider and rule that produced it.
- B4. Inference rules that exist in v1 — and no others. Rule identifiers below are proposed names:
  - **Open Food Facts rule** (ADR 0007), e.g. `OPEN_FOOD_FACTS_PORTION_DIMENSION`: applies only to products whose source is `OPEN_FOOD_FACTS`. Portion dimension MASS gives PER_100_G; VOLUME gives PER_100_ML; UNKNOWN gives no basis. Justified by OFF's own arithmetic convention (evidence note §5), recorded as provider-convention evidence rather than proof.
  - **Legacy user-submission rule** (R§3.7), `LEGACY_USER_SUBMITTED_MASS_GRANDFATHERING`: applies only to `USER_SUBMITTED` products that have **no** Declared basis and pre-date this feature. A MASS **package** unit gives PER_100_G. A VOLUME package unit, or a **missing** package unit, gives no basis — even when a serving unit exists. The result is **Inferred**, never Declared: historical data is not misrepresented as having stated its own denominator. The rule is defensive; no backfill is performed.
  - No rule applies to `ADMIN` products (they must declare) or to any future provider until one is written down for it.
- B5. **Safety invariant** (R§2.6): a product is scalable only when its Effective basis is known and matches the Consumed amount's dimension — MASS with PER_100_G, VOLUME with PER_100_ML. Every other combination is Not scalable.
- B6. Open Food Facts' `nutrition_data_per` is **never** read as a Declared basis, never used as conflict evidence, and never displayed as authoritative (R§2.3).

### C. Portion dimension resolution

- C1. Precedence (R§2.1): usable package unit → usable serving unit → Declared nutrition basis (PER_100_G → MASS, PER_100_ML → VOLUME) → UNKNOWN. UNKNOWN is never defaulted to grams.
- C2. **Package is authoritative over serving** (R§2.2) for both dimension and quantity. A serving whose dimension differs from the package's, or whose normalized amount exceeds the Package size, is **discarded as a portion shortcut** at resolution time. The stored serving is not deleted; it is simply not offered. Discarding is logged for diagnostics and not shown to the user (R§4, Q6 decision).
- C3. **Declared basis vs dimension conflict**: when a Declared basis contradicts a dimension established from the package or serving unit, the product is Not scalable with reason `DIMENSION_BASIS_CONFLICT` (R§2.7). Because OFF never supplies a Declared basis, this state is unreachable from Open Food Facts and is not manufactured from any OFF field.
- C4. Manual, USDA, canonical and local foods are always MASS with PER_100_G (R§1.5). Their behaviour does not change.

### D. Unit normalization

- D1. Units are normalized at ingestion — at the provider mapping boundary and at user submission — to a closed set of Base units: **G** and **ML** (R§1.4).
- D2. Accepted conversions: kg → g, mg → g; L, cl, dl → ml; **fl oz → ml**. Bare **oz** is ambiguous and treated as **absent metadata**. Any other unit ("portion", "piece", "bar", "serving", unrecognised text) is treated as absent metadata, never guessed.
- D3. Normalized quantities that are non-finite, zero or negative are treated as absent.
- D4. Equivalent expressions normalize identically: 0.33 L, 33 cl and 330 ml are all 330 ml; 1.5 L is 1500 ml; 0.06 kg is 60 g.
- D5. Package and serving units persist as the Base unit enumeration rather than free text. Container shape persists as an app-owned key (see G6). Raw provider strings are never persisted as user-facing labels.

### E. Open Food Facts mapping

- E1. The client reads OFF's **numeric normalized** fields — `product_quantity` / `product_quantity_unit` for Package size, `serving_quantity` / `serving_quantity_unit` for Serving size — and normalizes them per D. It no longer derives these by regex-parsing the free-text `quantity` / `serving_size`, which currently discards servings like "1 portion (330 ml)" (R§3.5). Whether the free-text fields remain as a fallback when the numeric fields are absent is left to the ticket, provided D2's no-guessing rule holds.
- E2. The client reads `packagings[].shape` and maps it to a container key (G6).
- E3. The client must distinguish three outcomes where today it has two: **found with nutrition**, **found without usable calories** (today collapsed into "not found"), and **not found**. Outage handling (timeouts, 5xx as unavailable; HTTP 404 and body `status: 0` as not found) is unchanged.
- E4. Nutriment fields consumed are unchanged (`energy-kcal_100g` and the macro `_100g` fields). Missing nutrients are never represented as zero.
- E5. The provider-lookup interface used by the resolver carries the new fields, so a future provider maps into the same shape and must state its basis semantics explicitly (R§3.9).

### F. Catalog, resolution and re-hydration

- F1. **Packaged product invariant is unchanged**: `caloriesPer100g` stays non-null (ADR 0004, R§3.1). A product lacking usable calories is never stored as a Packaged product.
- F2. **Identified-but-not-cataloguable barcode record** (R§3.2, R§3.8): a new lightweight model holding only barcode (unique), display name, brand and image where available, a reason (enumeration with one v1 value, `NUTRITION_MISSING`), provider/source, and the last provider check time. It is structurally unable to reach the calculator. It is **not** a general unloggable-product table: states a Packaged product can represent (`PORTION_DIMENSION_UNKNOWN`, `NUTRITION_BASIS_UNKNOWN`, `DIMENSION_BASIS_CONFLICT`) remain **derived** from the product row and are never duplicated into this record.
- F3. **Resolution order** (local-first, unchanged in spirit):
  1. A Packaged product with the barcode → resolve it (and apply F5 only if F5's trigger holds).
  2. Else an identification record with the barcode → return it as identified-not-loggable, re-checking the provider only if its retry window has elapsed.
  3. Else each configured provider in order. Found with nutrition → create a Packaged product. Found without calories → create or refresh the identification record. Not found → continue.
  4. Else not found, or unavailable if any provider errored — as today.
- F3a. **One source of truth per barcode**: a Packaged product always takes precedence over an identification record. When a valid Packaged product is successfully created for a barcode that has an identification record — by a user submission, or by a re-check that now finds calories — the identification record is **removed** as part of that creation, so the barcode never has two persistent sources of truth.
- F4. **Retry policy** (R§3.4): one policy, **30 days**, held as a named, configurable value. The timestamp lives on whichever subject owns the provider state — the Packaged product for portion recovery, the identification record for nutrition recovery. No separate provider-check-log table. Products with usable metadata never contact the provider.
  - **Completed check** — the provider answered: found but still without usable calories, found but still without usable portion metadata, or not found (HTTP 404 / body `status: 0`). The check timestamp advances and the 30-day window starts.
  - **Transient provider failure** — timeout, network or connection failure, outage, HTTP 5xx, or an equivalent transport/service failure; in today's client, everything reported as "temporarily unavailable" (E3). It is **not** a completed check: the 30-day timestamp is **not** advanced, the existing cached product or identification result is returned unchanged, and no product, portion or nutrition metadata is written.
  - Data-freshness retry (this policy) and transient-error backoff are separate concerns. If repeated calls during an outage need limiting, a distinct short-lived backoff is chosen at implementation time (register §9.4), never the 30-day window.
- F5. **Lazy re-hydration** (ADR 0005). **Trigger**: a scanned `OPEN_FOOD_FACTS` Packaged product whose locally stored portion metadata is missing or unusable **in a way that leaves the required portion semantics insufficient** — in v1, that its Portion dimension resolves to UNKNOWN because it has neither a usable Package size nor a usable Serving size — and whose retry window has elapsed. A missing *optional* shortcut is **not** a trigger: a product with a usable Package size and no Serving size (Scenario D) or a usable Serving size and no Package size (Scenario C) already resolves to a valid portion experience and never causes a provider call. Neither does a serving discarded under C2 while the package remains usable. This preserves the local-first principle: a provider call happens only when the local record cannot support safe, useful resolution on its own. When triggered, the write:
  - fills only portion fields (package size/unit, serving size/unit, container shape) that are currently absent or unusable;
  - never replaces a usable value with a different usable value;
  - never writes any nutrition field;
  - is never performed on `USER_SUBMITTED` or `VERIFIED` products;
  - records the check time for every **completed** check (F4), whether or not it filled anything.
  A transient provider failure during re-hydration must not fail the scan: the cached product is returned as-is, and neither its metadata nor its check time changes (F4).
- F6. **Resolution outcome contract** returned by barcode lookup — a discriminated result with, at least conceptually:
  - `LOGGABLE`: the product, its Portion dimension, its Effective nutrition basis **with provenance** (basis value, origin DECLARED or INFERRED, and, when inferred, the source and rule identifier), normalized Package size, usable Serving size (after C2), container key, and the portion options (G).
  - `NOT_LOGGABLE`: the identifying display data (name, brand, image), a structural indicator of **which kind of subject** it is — an **identified-but-not-cataloguable barcode** (no Packaged product exists; v1 reason `NUTRITION_MISSING`) or an **existing Packaged product that is Not scalable** (reasons `PORTION_DIMENSION_UNKNOWN`, `DIMENSION_BASIS_CONFLICT`, `NUTRITION_BASIS_UNKNOWN`) — and **one primary reason** for presentation. Never includes a nutrition figure to scale.
    - Choosing one primary reason is a **presentation choice, not a domain truth**. A suggested presentation order is `NUTRITION_MISSING`, `DIMENSION_BASIS_CONFLICT`, `PORTION_DIMENSION_UNKNOWN`, `NUTRITION_BASIS_UNKNOWN`, but the resolver may retain every applicable reason as internal diagnostics, and choosing the primary one must never erase the structural distinction above.
  - **Not found** and **unavailable** keep their existing HTTP semantics, and remain **semantically distinct** from `NOT_LOGGABLE`: not found means the barcode's identity is unknown; an identified-but-not-cataloguable barcode means identity is known but sufficient nutrition is not. The two may share fallback *actions* (manual search, add product), but never a state, a message, or an API shape.
- F7. **Provenance is exposed, not badged**: provenance fields exist for diagnostics and future code. The UI shows the Effective basis only, with no "inferred" badge (R§4.6).

### G. Portion options and defaults (client-side)

- G1. Options are built from the resolved product only; no size-based heuristics anywhere (R§4.2).
- G2. **Scenario defaults** (R§4.1):
  - **A** — Package size equals Serving size after normalization: **1 package** preselected; persisted Portion choice `PACKAGE × 1` (R§4.10). There is no combined package-and-serving kind.
  - **B** — Package size greater than Serving size: **1 serving** preselected. Never the whole package.
  - **C** — Serving size known, Package size unknown: **1 serving** preselected.
  - **D** — Package size known, Serving size unknown or discarded: **nothing preselected**; "Whole package" and custom offered; an explicit choice is required before saving.
  - **E** — neither known, product scalable: custom amount only, initially empty, in the Base unit.
  - Not scalable: no portion selector; the not-loggable explanation and fallbacks instead.
- G3. **Quick options** when a usable Serving size exists: 0.5, 1 and 2 servings; plus "Whole package" when Package size exists; plus custom. No 1.5 button and no package multiplier (R§4.3). This is a UX simplification only: any amount — 1.5 servings, 2 packages, 0.5 package — remains valid via custom input.
- G4. "Whole package" is always an explicit action except in Scenario A (R§4.4).
- G5. Every option shows its label **and** its resolved amount: "1 serving (250 ml)", "0.5 serving (125 ml)", "Whole package (1.5 L)", "1 can (330 ml)" (R§4.5). Display may render large volumes in L and large masses in kg; stored values stay in the Base unit.
- G6. **Container vocabulary** (R§4.7, R§4.11): OFF `packagings[].shape` is mapped by a small app-owned table to container keys, with **`PACKAGE` as the generic fallback** for any unmapped or absent shape. CAN, BOTTLE, JAR, BOX/CARTON and POUCH/BAG illustrate the intended vocabulary; they are **not a frozen exhaustive enumeration**. The exact normalized keys and the OFF shape-tag mapping are finalized during implementation, only after inspecting the shape tags the provider actually supplies. Whatever the final set, keys are presentation metadata only: they never affect Nutrition safety, the Portion dimension, defaults, or single-serving treatment, and are never inferred from name, brand, barcode, category or size.
- G7. **Language** (R§6.6): no i18n layer exists and none is built. Labels ship in the surrounding UI's language convention (English), always rendered from semantic keys (`CAN`, `G`, `ML`) so a future localization layer can translate without touching ingestion or nutrition logic.
- G8. The nutrition line reads "`<kcal>` kcal / 100 g" or "`<kcal>` kcal / 100 ml" from the Effective basis, replacing the hardcoded "kcal/100g".

### H. Technical input validation (server-enforced)

- H1. A Consumed amount is rejected when it is: non-numeric, NaN, ±Infinity, ≤ 0, has more than **one decimal place**, or is **≥ 1 000 000 000** (R§5.2).
- H2. The bound is a named constant expressing a technical limit (e.g. `MAX_SAFE_CONSUMED_AMOUNT_INPUT`), commented with its justification: far inside IEEE-754 exact-integer range so JSON round-trips exactly, and far inside `DECIMAL(65,30)` so no column overflows. It is never named or documented as a consumption maximum, following the codebase's `SCREAMING_SNAKE` + reason-comment convention.
- H3. Oversized or malformed input is rejected by validation with a specific reason, never surfacing as a database or internal error.
- H4. Input precision (1 decimal place) is distinct from calculation precision: computed nutrition is not rounded to one decimal place at intermediate steps (R§5.3).
- H5. Portion multipliers are validated the same way (finite, positive, within the bound).

### I. Nutrition safety (server-enforced)

- I1. On **create**, the server resolves the product, evaluates B5, and rejects with the machine-readable reason when Not scalable, or when the submitted amount's unit differs from the product's Effective basis.
- I2. On **update** with a changed amount, the same evaluation applies against the product's current state (see K for legacy behaviour).
- I3. Safety never depends on the client, and no client flag can bypass it.

### J. Plausibility advisory (client-side only)

- J1. Decision tree, evaluated in order (R§5.13):
  1. Package size known → advise only when `amount > 3 × packageSize` (strictly greater).
  2. Else, a valid Daily calorie target exists → advise only when `entryCalories > dailyCalorieTarget` (strictly greater than 100%).
  3. Else → no advisory.
- J2. Serving size never triggers an advisory, at any multiple (R§5.10). Showing "300 g ≈ 10 servings" as information is permitted.
- J3. At most one confirmation. When both package and calorie signals apply, the package comparison leads and the calorie figure is supporting context (R§5.11). The existing app convention is a native confirmation; the ticket may reuse it.
- J4. Confirming continues the save. The server never rejects an amount for plausibility, and no "confirmed" flag is sent (R§5.7). The daily calorie target is read from the existing client-side calorie-balance/user data; no fallback target is invented when there is no baseline (R§5.5).
- J5. The same advisory applies on edit (R§5.8).
- J6. Warned cases may be logged for diagnostics without unnecessary user context, and such logging is never authorization logic.

### K. Food log entries: schema, create, edit, legacy

- K1. **Schema**: the single `grams` column is replaced by `amount` (decimal) and `amountUnit` (Base unit), plus nullable `portionKind` (`PACKAGE` / `SERVING` / `CUSTOM`) and nullable `portionMultiplier` (ADR 0006, R§1.2–1.3). Computed nutrition columns are unchanged.
- K2. **Backfill**: every existing entry becomes `amount = grams`, `amountUnit = G`, `portionKind = null`. Historical amounts are MASS/grams forever and are never reinterpreted as millilitres from any later product lookup (R§6.3). Entries with a null Portion choice present as custom.
- K3. **Create and update requests** carry the amount, its unit, and the Portion choice. The amount is the resolved value that drives calculation. A structured Portion choice must be **internally consistent** with it against the product's current metadata:
  - `PACKAGE × m` requires a usable Package size, and `amount = m × packageSize`;
  - `SERVING × m` requires a usable Serving size (not one discarded under C2), and `amount = m × servingSize`;
  - `CUSTOM` carries no size relationship.
  Consistency is checked within half the input precision, so a legitimately rounded amount such as 0.5 × 125.5 g entered as 62.8 g is accepted. An **inconsistent structured choice is rejected** with a specific reason — it is never silently rewritten as CUSTOM, which would change what the request means. A user who intends an amount independent of any shortcut submits CUSTOM.
  This is deliberately different from K5: the CUSTOM fallback applies only to an **already stored** entry whose historical choice no longer matches its authoritative stored amount because product metadata changed *later*. It is never applied to a new request.
- K4. **New entries** from a barcode are always `PACKAGED_PRODUCT`. New `OPEN_FOOD_FACTS` entries are rejected; historical `OPEN_FOOD_FACTS` entries remain readable (R§3.6). A catalog write failure fails the request — never a fallback to a grams-only entry.
- K5. **Edit presentation** (R§5.12): the stored amount is authoritative. The stored Portion choice is re-resolved against current product metadata for presentation only; if it still yields the stored amount, the friendly label is shown, otherwise the entry is presented and edited as CUSTOM. The stored amount is never mutated to keep a label true.
- K6. **Edit of an entry whose product is now Not scalable** (R§6.5): the entry stays historically valid and is never altered. A meal-category change proceeds; an amount change is blocked with a clear stated reason. No historical-ratio calculation path is added.
- K7. **Legacy compatibility exception — historical `OPEN_FOOD_FACTS` entries** keep their pre-existing edit path, including live re-resolution from OFF (R§6.1), and stay outside the new safety enforcement where applying the new resolver would break backward compatibility — they have no Packaged product from which a Portion dimension could be resolved. Stated explicitly:
  - this is **legacy compatibility behaviour** confined to entries that already exist;
  - it is **not an endorsement** of the old calculation semantics;
  - **no new entry** may use this path (K4);
  - redesigning how historical `OPEN_FOOD_FACTS` entries recalculate remains a **deferred concern**.
- K8. **Orphaned `PACKAGED_PRODUCT` entries** (product row gone) keep their pre-existing behaviour of being uneditable (R§6.2). Implementing K6's recalculation skip must not incidentally change this.
- K9. History and edit views display each entry's amount with its unit. Entries in G display grams exactly as today.

### L. User-submitted products

- L1. A **Declared nutrition basis is required** for every new user-submitted product (R§3.9). Manual submission requires the user to choose or confirm PER_100_G or PER_100_ML.
- L2. Package size and Serving size stay **independent and optional**, each with a unit normalized per D. The user is never required to supply a serving.
- L3. **Creation-time scalability** (R§3.10): creation is rejected when the Declared basis is missing, or when it contradicts the product's own Portion dimension (e.g. per 100 g for a package in ml). A new product must not enter the catalog already Not scalable. Drafts, if ever wanted, are a separate model.
- L4. A serving whose dimension conflicts with the package is **not** a creation error; it is stored and discarded as a shortcut at resolution per C2, as for every source.
- L5. A product with no package and no serving but a Declared basis is valid and scalable via custom amount (Scenario E).
- L6. **OCR path**: the nutrition-label extraction result gains an optional Declared-basis suggestion, populated only when the label identifies the basis with sufficient confidence. Where it cannot, no basis is suggested and the user must select one. The user's confirmation is final. The extraction service is currently a stub that always reports itself unavailable, so in practice the basis is always user-selected until a real provider is configured.
- L7. The existing 409 conflict on a duplicate barcode is unchanged for Packaged products. Submitting a product for a barcode that has only an identification record is allowed. The add-product flow started from an identified-but-not-cataloguable result **pre-fills the trustworthy identity metadata already known** — barcode, name and brand where available — rather than treating the barcode as unknown, while nutrition and the Declared basis are still supplied by the user. A successful creation removes the identification record (F3a).
- L8. Users still cannot edit an existing shared product's metadata (R§1.7).

### M. Schema rollout under `db push`

- M1. The repo uses `prisma db push` with no migrations directory, and `db push` does **not** perform data backfills; replacing a populated column in a single push would drop data. The change is therefore staged:
  1. **introduce** the new representation safely, additively — new nullable columns, new enumerations, the identification model;
  2. **backfill** existing rows with an explicit one-off script (following the repo's existing one-off Prisma script pattern) — K2's amount backfill, and normalization of existing package/serving unit strings per D;
  3. **verify** the backfill;
  4. **tighten** constraints and retire the legacy representation — non-null amount and unit, and removal of `grams` and the old free-text unit columns.
- M2. Step 4 runs only after step 3 has verified every row in that environment. Environment coverage beyond the configured database is unknown (R§3.7), so the backfill must be idempotent and report counts.
- M3. **Deployment compatibility requirement**: frontend and backend deploy separately, so the staged rollout must preserve existing data and must **not open a deployment window in which valid requests break** in either order of arrival. The mechanism is **not fixed by this spec**. Temporarily accepting the old `grams` request field is one candidate; others (ordering of deploys, versioned request shapes) are equally admissible. The implementation plan chooses the safest mechanism against the actual deployment setup. Whatever it chooses must never let a grams-denominated request be scaled against a per-100 ml basis — the Nutrition safety invariant (B5) holds throughout the transition.
- M4. Both package versions are bumped in sync with the change, per project convention.

---

## Testing Decisions

### What makes a good test here

Tests assert **external behaviour at a module's public boundary** — what a lookup returns, what a create or update persists or rejects, what the portion selector offers and preselects — never the internal helpers that produce it. Every provider response is a **deterministic recorded fixture**; no test calls the live Open Food Facts API. Fixtures are shaped like real OFF responses, and where a real contradictory shape was found during research it is used (e.g. a 500 ml package with a 900 g serving, from barcode `6111099000247`).

### Seams (proposed — for confirmation)

All three are existing seams; no new test infrastructure is proposed. Two sides are unavoidable because the frontend and backend deploy separately with no shared package.

1. **OFF client seam** (backend, existing — `open-food-facts-client` unit tests with `fetch` mocked). Covers mapping and unit normalization: numeric fields, unit conversions, ambiguous units, container shape, and the three-way found / found-without-nutrition / not-found outcome.
2. **Food service seam** (backend, existing — the `food-log-edit-delete` and `product-resolver` unit tests with Prisma and providers faked). The primary seam. Covers resolution outcomes, the Effective basis and provenance, safety evaluation, re-hydration, the identification record, the retry window, create and edit, legacy entries, and technical validation. Product submission is exercised through the same service layer.
3. **Frontend portion-selector seam** (existing — the `node --test` barcode feature tests that load modules through Vite and render with `renderToStaticMarkup`). Covers option building, defaults A–E, labels with amounts, the nutrition-basis line, the plausibility decision tree, and the single-confirmation rule.

The e2e suite exists but does not run in CI; the ticket touching the schema should run it locally, per AGENTS.md.

### Required fixture scenarios (acceptance criteria)

Each must exist as a deterministic fixture exercised through the seams above (R§6.4 and the Q5 decision):

1. Coherent VOLUME product (package and serving in ml) → loggable, PER_100_ML inferred via the OFF rule, Scenario A or B defaults.
2. Coherent MASS product → loggable, PER_100_G inferred.
3. Package without serving → Scenario D, nothing preselected.
4. Serving without package → Scenario C, 1 serving preselected.
5. Serving dimension conflicting with the package dimension (500 ml package, 900 g serving) → serving discarded silently, package and custom offered, discard logged.
6. Serving amount greater than the package amount, same dimension → serving discarded.
7. No portion metadata at all, OFF source → Not scalable, `PORTION_DIMENSION_UNKNOWN`.
8. Equivalent normalized units — 0.33 L, 33 cl and 330 ml all produce 330 ml; 1.5 L produces 1500 ml; 0.06 kg produces 60 g.
9. Ambiguous or unsupported units — bare "oz", "portion", "1 bar" → absent metadata; "fl oz" → ml.
10. Declared-basis/dimension incompatibility on a user-submitted product → rejected at creation; on a pre-existing row → Not scalable, `DIMENSION_BASIS_CONFLICT`.
11. OFF product with inferred basis → provenance reports INFERRED with the OFF provider and rule identifier; never DECLARED; `nutrition_data_per` in the fixture has no effect, including `"100g"` on an ml product.
12. Identified product with missing calories → identification record created; `NOT_LOGGABLE` marked as an identified-but-not-cataloguable subject with `NUTRITION_MISSING`; never a Packaged product; never zero calories; distinguishable from a not-found response by state, not merely by message.
13. Legacy user-submitted rows with no Declared basis: MASS package → PER_100_G reported as INFERRED under `LEGACY_USER_SUBMITTED_MASS_GRANDFATHERING`, never DECLARED; VOLUME package → `NUTRITION_BASIS_UNKNOWN`; no package unit but a MASS serving → `NUTRITION_BASIS_UNKNOWN`.
14. Re-hydration trigger: a cached OFF product with **no** usable package or serving → provider re-queried; a product with a usable package and no serving → **no provider call**; a product with a usable serving and no package → **no provider call**; a product whose serving was discarded under C2 but whose package is usable → **no provider call**.
14a. Re-hydration write: fills only gaps; does not overwrite a usable value; does not touch nutrition; skips USER_SUBMITTED and VERIFIED; after a completed check that still yields no usable portion metadata, is not retried inside 30 days and is retried after 30 days; a transient provider failure (timeout, network, 5xx) returns the cached product unchanged and does **not** advance the 30-day check timestamp.
15. Identification record retry: no provider call inside the window, one after it; a completed re-check still without usable calories advances the check timestamp; a transient provider failure leaves the record and its timestamp unchanged; a successful re-check with calories creates a Packaged product and **removes** the identification record.
15a. User submission for a barcode with an identification record → allowed; the add-product flow is pre-filled with the known name and brand; a successful creation removes the record, leaving exactly one persistent source of truth.
15b. A Not-scalable existing Packaged product reports the Packaged-product subject kind with its reason, and may retain further internal diagnostics when more than one problem applies.
16. Technical validation: NaN, Infinity, 0, negative, 2 decimal places, and 1 000 000 000 rejected with specific reasons; 999 999 999.9 accepted.
17. Safety: grams against PER_100_ML rejected; ml against PER_100_G rejected; matching units accepted and computed as `value × amount / 100`.
18. Scenario A persistence → `PACKAGE × 1`. A new request whose structured choice is inconsistent with its amount (`SERVING × 1` with 600 ml against a 250 ml serving) → **rejected**, never rewritten as CUSTOM. The same 600 ml submitted as CUSTOM → accepted. `SERVING × m` against a serving discarded under C2 → rejected. A rounded amount within half the input precision → accepted.
19. Edit after serving metadata changed → stored amount unchanged, presented as CUSTOM.
20. Edit of an entry whose product is now Not scalable → meal-category change succeeds, amount change rejected with its reason.
21. Legacy `OPEN_FOOD_FACTS` entry edit → pre-existing behaviour unchanged (existing test continues to pass).
22. Orphaned `PACKAGED_PRODUCT` entry edit → pre-existing behaviour unchanged.
23. New `OPEN_FOOD_FACTS` create → rejected.
24. Backfilled legacy entries → amount in G, original calories, presented as custom.
25. Plausibility: for a 330 ml package, 330 / 660 / 990 ml → no advisory; 1000 and 3300 ml → advisory; no package with a target, at exactly 100% → no advisory, above → advisory; no package and no target → none; serving-only product at 10 servings → none; both signals → exactly one confirmation, package-led.
26. Manual, USDA, canonical and local logging → unchanged, amounts in G.

### Prior art

- The `open-food-facts-client` spec — the mocked-`fetch` pattern and response shapes.
- The `product-resolver.service` spec — the provider/catalog orchestration pattern.
- The `food-log-edit-delete` spec — the service-level create/update pattern with Prisma faked, including the legacy OFF edit case.
- The `calorie-calculator` spec — the arithmetic.
- The `create-packaged-product.dto` spec — DTO validation.
- The frontend `barcode-feature` test — the Vite SSR module-loading and static-render pattern.

---

## Out of Scope

Explicitly deferred (R§7), each a real problem left for its own work:

- **Legacy `OPEN_FOOD_FACTS` edit refresh** — editing such an entry re-resolves live from OFF and can recompute from different provider values than it was created with. Pre-existing; not introduced or fixed here.
- **Orphaned-entry editing** — entries whose product row is gone cannot be edited at all, even for meal category. Pre-existing; not fixed here.
- **Historical-ratio edit path** — recomputing an amount change from an entry's own stored calories-per-amount.
- **Reviewable completion or correction of shared product metadata** by users.
- **A nutrition-refresh policy** for cached products (excluded by ADR 0005).
- **A UI localization layer**, including Arabic container nouns and unit labels.
- **Product drafts** — incomplete user submissions saved without a Declared basis.
- **A real OCR/vision provider** for nutrition-label extraction.
- **COUNT as a measurement dimension**, and any per-piece nutrition.
- **Density-based conversion** between mass and volume.
- **Changes to manual, USDA, canonical, local or voice logging**, beyond their amounts being stored with an explicit G unit.
- **Serving-relative plausibility warnings**, per-container-shape thresholds, and any server-side consumption ceiling.
- **Dedicated 1.5-serving and package-multiplier quick buttons.**

## Further Notes

- **Assumptions**: the nine assumptions raised in the first draft were all reviewed and settled, and are now written into the sections above — inferred-basis persistence and provenance (B3), the legacy grandfathering rule's Inferred classification and name (B4), the re-hydration trigger (F5), primary reason versus structural subject kind (F6), rejection of inconsistent new Portion choices (K3), the legacy `OPEN_FOOD_FACTS` compatibility exception (K7), the distinct identified-versus-not-found states with pre-filled identity (F3a, F6, L7), the non-frozen container vocabulary (G6), and the staged rollout with an unfixed compatibility mechanism (M1–M3). No open assumptions remain.
- **Left to implementation on purpose** (decisions whose inputs only exist at build time, not open questions): the final container keys and OFF shape-tag mapping (G6); the deployment-compatibility mechanism (M3); whether the free-text OFF size fields remain a fallback beneath the numeric ones, within D2's no-guessing rule (E1); and the short-lived transient-provider-error backoff, if one is needed (F4). All four are recorded in register §9.
- **Proposed names** in this spec (`amount`, `amountUnit`, `portionKind`, `portionMultiplier`, `MAX_SAFE_CONSUMED_AMOUNT_INPUT`, the reason codes, the inference-rule identifiers) are proposals for `to-tickets` to adopt or adjust; the identification model's name is deliberately left open.
- **Consequence of the narrowed re-hydration trigger (F5), stated so it isn't mistaken for an omission**: a cached product that has a usable package but lost its serving to the old lossy regex mapping will **not** recover that serving through re-hydration, because a missing optional shortcut never triggers a provider call. Such products still resolve correctly as Scenario D. The configured database currently holds zero Packaged products, so nothing is affected there today.
- **Edge cases from the original brief not named elsewhere above**: the same product name at different sizes, and the same brand under different barcodes, are separate Packaged products with independent portion metadata, because a product's identity is its barcode (ADR 0004). Products that look like beverages but carry mass metadata, or look like foods but carry volume metadata, simply take the dimension their units give them (C1) — there is no food/drink classification to disagree with. Every other brief edge case maps to a section above or to a fixture scenario.
- Nothing in this spec contradicts ADRs 0004–0007. ADR 0004's non-null calorie invariant is preserved rather than relaxed (F1).
