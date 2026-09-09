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
