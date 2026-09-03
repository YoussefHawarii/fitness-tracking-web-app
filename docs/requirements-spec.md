# Requirements / Product Specification
## Calorie & Weight Tracking Web App

### 1. Purpose
A web app for anyone who wants to track daily food/calorie intake — log food intake (via barcode scan, voice, or manual entry), track calories against a personal baseline, and get a non-clinical, directional prediction of weight change over time. Built as a portfolio project targeting Backend Engineer roles — must be free to run and host.

### 2. Goals
- Give the user a working calorie log with minimal manual data entry friction.
- Predict weight trend (not exact) from calories in vs. calories burned.
- Demonstrate backend-relevant skills: relational data modeling (PostgreSQL + Prisma), third-party API integration, browser media APIs (camera, microphone), auth, and free-tier deployment architecture.

### 3. Explicitly Out of Scope (decided against, with reason)
- **Photo-based plate recognition (computer vision).** Rejected in favor of voice logging — avoids paid image-recognition API costs (e.g. LogMeal) and a much larger ML/CV build.
- **Building an in-house crowdsourced packaged-food database.** Rejected — Open Food Facts already provides this; duplicating it has a cold-start problem with no users on day one.
- **Automatic portion/gram estimation from any input.** Out of scope entirely — user always enters grams manually. This removes the least reliable part of any food-logging approach.
- **Household unit conversion (cup, piece, etc.).** v1 uses grams only; unit conversion deferred to a later version.

### 4. Functional Requirements

**4.1 Onboarding / Signup**
- Collect: age, sex, height, current weight, goal weight, activity level (gym frequency).
- This data seeds the BMR/TDEE baseline used for all later predictions.

**4.2 Weight Prediction**
- Calculate BMR + activity multiplier → TDEE.
- Compare daily logged calorie intake against TDEE.
- User can log calories burned that day (manual entry, not device-synced).
- Project estimated weight change over a 1–2 week window using the ~7700 kcal/kg rule.
- User logs their actual weight periodically; these logged weigh-ins are compared against the predicted trend to show how accurate the prediction is turning out to be.
- Must be presented as a directional estimate, not a medical or precise measurement.

**4.3 Food Logging — three input paths**
- **Barcode scan:** camera → client-side barcode decode (e.g. html5-qrcode/zxing-js) → lookup against Open Food Facts API. Covers packaged snacks, cold cuts, supermarket products.
- **Voice logging:** user records what they ate → browser Web Speech API (speech-to-text, client-side, free) → parsed food terms → matched against USDA FoodData Central (generic/homemade foods: rice, chicken, vegetables, etc.).
- **Manual entry (fallback):** used when neither source has the item. Saved to the app's own local food table, scoped to the user who added it (not shared across accounts). Entry is validated for correct data types/schema (e.g. calorie field must be numeric) on save — content accuracy is the user's own responsibility, not something the app verifies.
- All three paths converge on the same step: user enters grams for each identified item → app calculates calories from the matched database entry.

**4.4 Data Sources (three, each with a distinct job)**
| Source | Covers | Cost |
|---|---|---|
| Open Food Facts API | Barcoded/packaged products | Free, no key |
| USDA FoodData Central | Generic/homemade foods | Free, requires free API key |
| Local app database | User-added items not found elsewhere (private to that user, type-validated on entry) | Self-hosted, free |

**4.5 History / Logging**
- Persist meal logs, weight entries, and calories-burned entries per user, tied to a date, for trend calculation and history review.
- Each meal log entry is tagged with a category: Breakfast, Lunch, Dinner, or Snacks.

### 5. Non-Functional Requirements
- **Cost: must run at $0/month** at portfolio-demo scale (single user + occasional recruiter traffic). Free-tier hosting accepted trade-off: backend cold-start delay on first request after idle.
- **Stack:** PostgreSQL + Prisma ORM; Node.js/NestJS backend; React or Angular frontend (existing skillset).
- **Data integrity:** foreign-key relationships between users, meal logs, and food items enforced at the database level.
- **Day-boundary handling:** "daily" totals use midnight-to-midnight in the user's local timezone, not server time. Timestamps stored in UTC; user's timezone captured at signup or from the browser and used to compute day boundaries.

### 6. Open Questions (not yet decided — need answers before design/build phase)
- **Speech recognition accuracy for Egyptian Arabic dialect:** to be validated with a quick manual test (Web Speech API, `lang: ar-EG`, real dialectal phrases) before building the feature. Regardless of test outcome, transcribed text must always be shown to the user for edit/confirmation before matching against the food database — mitigates mis-transcription risk either way. If accuracy proves too poor, fallback is a self-hosted Whisper model (free, open-source) instead of a paid API — trade-off: needs real backend CPU, which may conflict with the $0-hosting constraint in §5.

### 7. Success Criteria (for v1 / portfolio scope)
- User can sign up, log meals via all three input paths, and see a calorie total for the day.
- User can view a predicted weight trend based on logged data.
- Entire stack runs on free-tier infrastructure with no recurring cost.
