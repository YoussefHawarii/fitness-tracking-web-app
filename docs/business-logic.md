# Business Logic
## Calorie & Weight Tracking Web App

### 1. User Baseline Calculation (at signup)
- **BMR (Mifflin-St Jeor equation):**
  - Men: `BMR = 10×weight(kg) + 6.25×height(cm) − 5×age(years) + 5`
  - Women: `BMR = 10×weight(kg) + 6.25×height(cm) − 5×age(years) − 161`
- **TDEE = BMR × activity multiplier.**
  - **Design decision (flagging, not previously discussed explicitly):** the activity multiplier used here should reflect the user's *non-exercise* baseline activity, NOT a "trains 4–5x/week" multiplier. This still holds even though exercise is no longer added into `Calories expended` (see §2) — the multiplier is meant to represent everyday non-exercise activity, not to double as an exercise-inclusive estimate.
  - **Activity level has 3 tiers** (`Backend/src/modules/users/baseline-calculator.ts`): "Lightly active" (`1.2`), "Moderately active" (`1.375`), "Very active" (`1.55`). The labels are a loose, familiar proxy for everyday activity — not a literal exercise-frequency input — so the top tier deliberately stays a modest step up rather than the 1.725/1.9 a true exercise-inclusive scale would use, to avoid double-counting with logged exercise.
- Baseline is recalculated whenever the user updates their profile (weight, height, age), not just at signup.
- **Goal direction** (`Backend/src/modules/users/goal-direction.ts`): a derived label — `LOSE` / `MAINTAIN` / `GAIN` — computed by comparing Goal weight to current weight, with a ±0.5 kg tolerance counting as `MAINTAIN`. It's never stored; it's recomputed on every response.
- **Daily calorie target** = TDEE − 500 kcal (`LOSE`) / TDEE (`MAINTAIN`) / TDEE + 500 kcal (`GAIN`). Deliberately kept separate from TDEE — see `docs/adr/0001-separate-daily-calorie-target-from-tdee.md` — because TDEE must stay unadjusted to keep the weight-trend prediction (§3) physiologically accurate. Daily calorie target only drives the Dashboard's "remaining calories" figure and the Goals page's "Daily target" display.

### 2. Daily Calorie Balance
- `Calories consumed` = sum of all food log entries for the day (see §4).
- `Calories expended` = `TDEE (baseline)` only.
  - **Revised 2026-08-30**: logged exercise calories are **not** added into `Calories expended` or the balance/remaining-calories figure. An earlier version of this app added exercise burn on top of TDEE (see git history), which made "remaining calories" silently increase whenever exercise was logged — confusing, since it wasn't obvious *why* the number moved. Exercise burn is still recorded (`ExerciseLogEntry`) and reported to the user as its own separate, informational stat for the day, but it no longer feeds the balance calculation.
  - **Exercise entry remains optional per day**, and now has no effect on the balance calculation either way — it exists purely for the user's own tracking.
  - **Added 2026-08-30 (specs/004-exercise-tracking-page)**: exercise sessions are logged by selecting a sport and a duration rather than typing a calorie number directly. `Calories burned (exercise) = MET(sport) × body weight (kg) × duration (hours)`, using the user's current baseline weight and a fixed MET value per sport (Football, Swimming, Padel, Basketball, Gym/Weight Training, Running, Tennis, or a general "Other" default for a typed activity). This only changes how the exercise figure is calculated and made editable — it remains excluded from `Calories expended`/balance as described above.
- `Daily balance = Calories consumed − Calories expended.`
  - Negative = deficit (weight loss direction). Positive = surplus (weight gain direction).
  - **Added (Daily calorie target)**: the Dashboard's "remaining calories" figure is `Daily calorie target − Calories consumed` (see §1), not `Calories expended − Calories consumed`. `Calories expended`/`Daily balance` here are unaffected and keep using raw TDEE — only the user-facing "remaining calories" ring reflects the goal-adjusted target.

### 3. Weight Trend Prediction
- `Cumulative balance` = sum of daily balances over the prediction window (1–2 weeks, per spec).
- `Predicted weight change (kg) = Cumulative balance ÷ 7700` (kcal per kg of body weight, standard approximation).
- `Predicted weight = Current weight + Predicted weight change.`
- Must be displayed as a directional estimate, not a precise figure (per requirements §4.2 — "non-clinical, directional").
- **Comparison against reality:** when the user logs an actual weigh-in (§8), compare it to the predicted weight for that date and show the delta (predicted vs. actual), so the user can see how well the model is tracking them.

### 4. Food Log Calorie Calculation
- Every food database entry (Open Food Facts, USDA FoodData Central, or user's local entry) stores nutrient values **per 100g**.
- When a user logs an item with a given gram amount:
  `Calories for entry = (nutrient_per_100g ÷ 100) × grams_entered`
- Same formula applies to any other tracked macros (protein/carbs/fat) if those are shown.
- Units are grams-only for v1 (per requirements §3 — household units deferred).

### 5. Food Lookup Routing Logic
Order of resolution, per input method:

- **Barcode scan path:**
  1. Decode barcode client-side.
  2. Query Open Food Facts by barcode.
  3. **Important implementation rule:** Open Food Facts returns HTTP 200 even when it has no data for that barcode — the app must check the response body's status field, not just the HTTP status code, or it will silently log an empty/zero result as if it were real data.
  4. If not found → fall through to manual entry (private to that user, per requirements §4.3/§4.4).

- **Voice logging path:**
  1. Record audio → transcribe via Web Speech API (`lang: ar-EG`).
  2. Show transcribed text to the user for edit/confirmation before proceeding (mandatory step — mitigates mis-transcription, per requirements §6).
  3. Parse confirmed text into individual food terms.
  4. Query USDA FoodData Central by each term; present candidate matches for the user to pick from (don't auto-select the top match silently — voice-to-text and generic food names both carry enough ambiguity that a silent auto-pick risks logging the wrong food).
  5. If no match found → fall through to manual entry.

- **Manual entry:**
  - Always available directly, and as the fallback for both paths above.
  - Scoped privately to the user who created it (per requirements §4.3).
  - Validated for correct data type on save (e.g. calorie/macro fields must be numeric, name field required) — not validated for factual accuracy, which remains the user's responsibility.

### 6. Meal Categorization
- Every food log entry must be tagged: Breakfast, Lunch, Dinner, or Snacks (per requirements §4.5).
- **Assumption to confirm (not yet decided in our discussion):** category is manually selected by the user at log time. An alternative — auto-suggesting a category based on time of day (e.g. defaulting to "Breakfast" before 11am) — was raised but not settled. Defaulting to manual selection here as the simpler, safer v1 behavior; flag if you want auto-suggestion instead.

### 7. Day-Boundary Logic
- "Daily" totals (calories consumed, calories expended, daily balance) are computed midnight-to-midnight in the **user's local timezone**, not server time.
- Timestamps stored in UTC; user's timezone captured at signup or read from the browser; day-boundary math is computed relative to that stored timezone (per requirements §5).

### 8. Weigh-In Logging
- User logs actual weight periodically (cadence not restricted — logged whenever the user chooses).
- Each logged weigh-in is compared against that date's predicted weight (from §3) to surface prediction accuracy over time.

### 9. Known Limitations (carried from requirements — restated here as logic-level caveats)
- Weight prediction is a rough estimate, not a medical calculation — the 7700 kcal/kg rule and Mifflin-St Jeor formula are approximations, not individualized metabolic measurements.
- Manual entries are unverified for accuracy — the app enforces data type correctness only, not correctness of content.
- Voice transcription accuracy for Egyptian Arabic dialect is unvalidated pending the test noted in requirements §6.
