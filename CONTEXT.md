# Calorie & Weight Tracking Web App

Domain glossary for onboarding, calorie balance, weight-goal tracking, cardio exercise logging, and strength workout tracking.

## Language

**Goal weight**:
The numeric target body weight (kg) a user is working toward, entered at signup and editable on the Goals page.
_Avoid_: Target weight, desired weight

**Goal direction**:
A computed label (Lose / Maintain / Gain) derived by comparing Goal weight to the user's current weight, with a ±0.5 kg tolerance band counting as Maintain. Never stored as its own field — recomputed wherever needed, including live during onboarding as the user types their goal weight.
_Avoid_: Weight objective, weight goal type (an earlier design considered a separate stored field for this; rejected in favor of deriving it from Goal weight)

**Activity level**:
A self-reported, non-exercise baseline activity tier (Lightly active / Moderately active / Very active) used only to select the TDEE multiplier. Deliberately not a measure of exercise frequency — logged exercise is tracked and reported separately and must not double-count into this multiplier.
_Avoid_: Training level, exercise frequency, gym frequency

**TDEE (Total Daily Energy Expenditure)**:
The physiological baseline calorie estimate (BMR × activity multiplier) representing what the user's body burns in a day, independent of any dietary goal. Drives the daily calorie balance and the weight-trend prediction; never adjusted by Goal direction.
_Avoid_: Daily calorie target, daily target (distinct concepts — see below)

**Calories expended**:
The name `docs/business-logic.md`'s daily-balance formula (`Calories consumed − Calories expended`) gives to TDEE in that specific context. Same figure as TDEE, not a separate concept.

**Daily calorie target**:
The number of calories the app recommends the user eat today: TDEE adjusted by Goal direction (−500 kcal for Lose, unchanged for Maintain, +500 kcal for Gain). Drives the Dashboard's "remaining calories" figure. Deliberately distinct from TDEE, which stays unadjusted so the weight-trend prediction reflects real physiology rather than the user's aspiration.
_Avoid_: Daily target (ambiguous with TDEE — always qualify as "Daily calorie target")

### Exercise & workout tracking

**Exercise (cardio)**:
A logged cardio/sport session — a sport type (Football, Swimming, Padel, Basketball, Running, Tennis, Gym/Weights, Other), a duration, and a computed calories-burned figure. Tracked on the "Exercise" page. Never records specific movements, reps, sets, or weight lifted.
_Avoid_: Workout, training session (reserved below for the separate strength-training concept)

**Workout**:
A logged strength-training session: one or more Muscle groups tagged to the session, containing one or more Workout exercises. Tracked on the "Workouts" page. Never records duration or calories burned — only what was trained, how heavy, and for how many reps/sets.
_Avoid_: Exercise session, training session, gym session

**Muscle group**:
One of a fixed set of body-region tags — Chest, Back, Shoulders, Biceps, Triceps, Legs, Abs/Core — used two ways: tagged onto a Workout to record what was trained that session, and assigned as the single primary mover of every catalog Exercise. No Cardio muscle group exists; Muscle group applies only within Workouts.
_Avoid_: Body part, workout type, split (e.g. "push day") — the app has no first-class concept of a named split; a session is just the Muscle groups tagged to it.

**Workout exercise**:
A specific, predefined strength movement (e.g. Lat Pulldown, Barbell Bench Press) belonging to exactly one Muscle group, selectable from a fixed catalog — not user-creatable in v1. Logged within a Workout, it becomes a record of that movement performed that session, containing one or more Sets.
_Avoid_: Exercise (ambiguous with Exercise (cardio) above — always say "Workout exercise" when discussing strength movements)

**Set**:
One discrete unit of a Workout exercise: a rep count plus an optional weight (kg).

**Bodyweight set**:
A Set logged with no weight value (weight left blank), as opposed to a Set with an explicit weight of 0 — the app never asks the user to enter 0 for a bodyweight movement, and the two are never treated as equivalent.

### Packaged products

**Packaged product**:
A barcode-identified branded/retail item (e.g. a specific size of Chipsy or Pepsi), distinct from a Canonical food (a generic, unbranded food matched by name, e.g. "rice") because two different package sizes of the same product are different Packaged products even though a Canonical food is deduplicated by name.
_Avoid_: Product, Food item (ambiguous with the pre-existing LocalFoodItem/CanonicalFood concepts already in this glossary)

**Identified barcode**:
A provider-confirmed barcode identity that cannot enter the Packaged product catalog because required catalog data is absent — in v1, usable calories. It may retain a display name, brand, image, provider, reason, and provider-check time, but has no nutrition fields and cannot be referenced by a Food log entry. It is distinct from not found (identity is known) and from a Not scalable Packaged product (no Packaged product exists). The persisted model is `IdentifiedBarcode`; its API subject kind is `IDENTIFIED_NOT_CATALOGUED`.
_Avoid_: Unloggable product (too broad), incomplete Packaged product (it is not in that catalog)

**Product source**:
Where a Packaged product's data originated — OPEN_FOOD_FACTS, USER_SUBMITTED, or ADMIN. Never changes after creation.
_Avoid_: Provider (reserved for the resolution-order concept, not the stored provenance tag)

**Verification status**:
A Packaged product's data-quality state — UNVERIFIED (default, includes every fresh user submission), EXTERNAL (came from a structured source like Open Food Facts, not hand-checked), or VERIFIED (deliberately confirmed, e.g. by an admin).
_Avoid_: Verified (bare) — always say "Verification status: VERIFIED" to avoid implying Open Food Facts data is trustworthy by default

### Portion model (packaged products)

**Portion dimension**:
The dimension in which a product's package, serving, and consumed quantities are expressed — MASS, VOLUME, or UNKNOWN. A property of the product, never of the barcode, and deliberately not a "food vs drink" or "solid vs liquid" classification: the only question it answers is which unit the product's amounts are expressed in. The two real dimensions are never converted into each other; there is no density concept anywhere in the app. UNKNOWN is a first-class outcome, not a synonym for MASS — it means no signal established the dimension, and it is never silently resolved to grams for compatibility with the app's older mass-only flows.
_Avoid_: Measurement dimension (an earlier name for this concept, retired so the app never carries two names for one idea), product type, liquid/solid flag, beverage flag

**Base unit**:
The single canonical unit each Portion dimension is stored in — grams for MASS, millilitres for VOLUME. Every quantity is normalized to its Base unit at the boundary where it enters the system, so no L/kg/cl/oz value is ever stored or compared. A unit that cannot be normalized unambiguously (bare "oz", "portion", "piece") is treated as absent metadata rather than converted by guess; "fl oz" is a VOLUME unit and "oz" alone is never assumed to mean either dimension.
_Avoid_: Unit (bare — always say Base unit when referring to the stored form)

**Nutrition basis**:
The denominator the stored nutrition values describe — PER_100_G, PER_100_ML, or UNKNOWN. An umbrella over the two kinds below, which are never merged: any consumer of this concept must be able to tell whether the denominator was stated by the source or worked out by us.
_Avoid_: Per 100g (as a universal phrase — accurate only for MASS products)

**Declared nutrition basis**:
A Nutrition basis stated explicitly and unambiguously by the source — a nutrition label read by a person, an admin entry, or a provider field that genuinely asserts the denominator. Never inferred, and never synthesized from package or serving units, which are evidence about the Portion dimension and not about the denominator. Open Food Facts' `nutrition_data_per` does not qualify: it is a contributor-set flag taking only "100g" or "serving", it is frequently absent, and grouping products by it produces no separation in their actual nutrient values — see docs/off-nutrition-basis-evidence.md.
_Avoid_: Nutrition basis (bare) wherever the distinction matters

**Inferred nutrition basis**:
A Nutrition basis established by a named, source-specific inference rule rather than by an explicit statement, permitted only where documented evidence about that source's semantics supports it, and always recorded as inferred rather than passed off as Declared. "Recorded as inferred" means classified as INFERRED wherever the basis is represented — in a product's resolution result and its provenance, together with the rule (and provider, where one applies) that produced it. It does not mean the inferred basis must be stored: because the rule reproduces it deterministically from the product's source and portion data, it need not be persisted, whereas a Declared nutrition basis is stored as declared product metadata. For example, an Open Food Facts product whose Portion dimension is VOLUME has an Inferred basis of PER_100_ML under the Open Food Facts rule; a legacy user-submitted product with a mass package unit and no Declared basis has an Inferred basis of PER_100_G under the legacy grandfathering rule. Deliberately not a universal domain rule of the form "VOLUME product means PER_100_ML": each source is entitled to its own semantics, and a future provider may warrant no inference at all.
_Avoid_: Assumed basis, default basis, and specifically Effective nutrition basis — a different concept, below

**Effective nutrition basis**:
The basis the nutrition calculation is actually permitted to use: a Declared nutrition basis where one exists, otherwise an Inferred nutrition basis where an applicable inference rule allows one, and otherwise UNKNOWN — the basis accepted by the calculation safety rules for the current resolution. The only one of the three the calculator ever reads, and the one shown to the user — who is told the measurement semantics ("42 kcal / 100 ml"), not the provenance behind them. Never a fourth value invented by the calculator, and never a way to smuggle a guess past an UNKNOWN: if no Declared and no permitted Inferred basis exists, the Effective nutrition basis is UNKNOWN and the product is not scalable.
_Avoid_: Nutrition basis (bare) in calculation contexts — name which of the three is meant

**Not scalable**:
A resolved product state meaning the app declines to compute nutrition from it, because the Effective nutrition basis is UNKNOWN, because a Declared nutrition basis contradicts the Portion dimension, because the Portion dimension is UNKNOWN, or because required nutrition values are absent. Distinct from "product not found": the barcode was identified and the product can be named and shown, it simply cannot be logged. Never resolved by substituting zero for a missing value, and never overridden by the presence of package or serving metadata.
_Avoid_: Invalid product, bad product, unsupported product

**Package size**:
How much product the package identified by the barcode contains, in the Base unit. Describes the package, never consumption: a scanned 1500 ml bottle never implies 1500 ml was drunk.
_Avoid_: Quantity, product size, net weight

**Serving size**:
A reference serving supplied by reliable product metadata, in the Base unit. Never fabricated to improve the UX — a product with no serving metadata has no Serving size, and that absence is represented rather than filled in.
_Avoid_: Portion, portion size (reserved for Portion choice below)

**Servings per package**:
The ratio of Package size to Serving size. Always derived where needed, never stored, and undefined whenever either input is missing.

**Consumed amount**:
What the user actually consumed, in the Base unit — the only quantity nutrition is ever calculated from, and the only one recorded on a food log entry as a quantity. Independent of both Package size and Serving size; a user may consume more or less than either.
_Avoid_: Grams (the historical name for this on food log entries, accurate only for MASS)

**Portion choice**:
How the user expressed their Consumed amount — a whole package, a number of servings, or a custom amount — recorded alongside the resolved Consumed amount so an entry can be shown and re-edited in the terms the user originally used. Never an input to the nutrition calculation, which always uses the resolved Consumed amount.
_Avoid_: Serving count (only one of the three forms)

**Container shape**:
A display noun for a package (can, bottle, jar), taken only from structured provider metadata such as Open Food Facts' `packagings[].shape` taxonomy — never inferred from the product's name. When absent, the generic noun "package" is used instead.
_Avoid_: Container type, packaging
