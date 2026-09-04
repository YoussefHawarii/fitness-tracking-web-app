# Calorie & Weight Tracking Web App

Domain glossary for onboarding, calorie balance, and weight-goal tracking.

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
