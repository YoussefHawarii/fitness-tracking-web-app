# Feature Specification: Calorie & Weight Tracking Web App

**Feature Branch**: `001-calorie-weight-tracking`

**Created**: 2026-08-27

**Status**: Draft

**Input**: User description: "Read the existing project documentation in the docs/ directory before proceeding. The documentation contains the approved requirements, business logic, system architecture, database decisions, API requirements, technical constraints, and other project decisions for this Fitness Tracking application. Use these documents as the primary source of truth. Create the specification for the Fitness Tracking application based on the existing documentation."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create Account and Establish Personal Baseline (Priority: P1)

A new user signs up, provides their age, sex, height, current weight, goal weight, and activity level, and the system establishes a personal calorie baseline (BMR/TDEE) that will be used for every later comparison and prediction.

**Why this priority**: Every other feature (food logging comparison, balance, prediction) depends on a baseline existing first. Without it, calorie totals have nothing to be measured against.

**Independent Test**: Can be fully tested by completing signup with valid onboarding data and verifying a baseline (BMR/TDEE) is computed and stored, independent of any food logging.

**Acceptance Scenarios**:

1. **Given** a new visitor, **When** they sign up via system (email/password) or Google and complete the onboarding form (age, sex, height, current weight, goal weight, activity level), **Then** the system computes and stores a BMR/TDEE baseline for that user.
2. **Given** an existing user, **When** they update their weight, height, or age in their profile, **Then** the baseline is recalculated using the new values.
3. **Given** a user who previously signed up via system with a given email, **When** they later sign in with Google using the same, verified email, **Then** the two accounts are merged into one rather than creating a duplicate account.
4. **Given** a system signup with an email that has not yet been verified, **When** a Google sign-in later arrives with the same email, **Then** the accounts are not silently merged until the system-side email is verified.

---

### User Story 2 - Log Meals via Barcode, Voice, or Manual Entry (Priority: P2)

A user logs what they ate using whichever input method fits the food: scanning a packaged product's barcode, speaking what they ate, or typing it in manually. Every entry converges on the user entering the grams consumed, and the system calculates and stores the calories.

**Why this priority**: Food logging is the core, highest-frequency activity in the app and the primary source of the data that powers the calorie balance and prediction features.

**Independent Test**: Can be fully tested by logging one food item through each of the three input paths and confirming each produces a correctly calculated, saved log entry tagged with a meal category — independent of baseline or prediction features.

**Acceptance Scenarios**:

1. **Given** a user scanning a packaged product's barcode, **When** the barcode is decoded and a matching product is found in Open Food Facts, **Then** the user enters grams consumed and the system calculates and saves the calorie/macro values for that entry.
2. **Given** a barcode scan where Open Food Facts returns a response with no actual product data for that barcode, **When** the app evaluates the response, **Then** it treats this as "not found" (based on the response body's status, not just the HTTP status code) and offers manual entry rather than logging a zero/empty result.
3. **Given** a user recording what they ate by voice, **When** speech is transcribed, **Then** the transcribed text is shown to the user for edit/confirmation before any food matching occurs.
4. **Given** confirmed voice-transcribed text, **When** the system searches USDA FoodData Central for matching foods, **Then** candidate matches are presented to the user to choose from rather than auto-selecting a match.
5. **Given** a food item not found via barcode or voice matching, **When** the user chooses manual entry, **Then** they can create a private entry (name, calories/100g, and macros) that is validated for correct data types before saving.
6. **Given** any successfully matched or manually entered food item, **When** the user enters a gram amount, **Then** calories are calculated as `(nutrient per 100g ÷ 100) × grams entered`.
7. **Given** a food log entry being saved, **When** the user completes the entry, **Then** it must be tagged with exactly one meal category: Breakfast, Lunch, Dinner, or Snacks.

---

### User Story 3 - View Daily Calorie Balance and Optionally Log Exercise (Priority: P3)

A user views how their day's eaten calories compare against their baseline energy needs, optionally adding calories burned from exercise to see a more complete picture.

**Why this priority**: This is the first point where logged data becomes actionable insight (deficit/surplus), building directly on Stories 1 and 2, but is not required for basic logging to have value.

**Independent Test**: Can be fully tested by logging food for a day (with baseline already established) and verifying the displayed daily balance, with and without an exercise entry, calculates correctly.

**Acceptance Scenarios**:

1. **Given** a user with an established baseline and one or more food logs for the current day, **When** they view their daily summary, **Then** the system shows calories consumed, calories expended (baseline TDEE plus any logged exercise burn), and the resulting balance (consumed − expended).
2. **Given** a user who has not logged any exercise for the day, **When** the daily balance is calculated, **Then** exercise calories burned default to zero and the balance uses baseline TDEE alone.
3. **Given** a user who logs calories burned from exercise for a specific day, **When** the daily balance is recalculated, **Then** the logged exercise calories are added to expended calories for that day only.
4. **Given** a user viewing totals for a specific calendar day, **When** the boundary between two days is evaluated, **Then** it is based on midnight-to-midnight in the user's local timezone, not server time.

---

### User Story 4 - View Predicted Weight Trend and Compare Against Actual Weigh-ins (Priority: P4)

A user views a directional, non-clinical prediction of how their weight is likely to change over the next 1–2 weeks based on their logged calorie balances, and can log their actual weight periodically to see how well the prediction is tracking reality.

**Why this priority**: This is the app's differentiating, higher-value feature, but it depends entirely on baseline (Story 1) and consistent logging (Stories 2–3) already being in place, so it is built last.

**Independent Test**: Can be fully tested by generating several days of daily balances for a user, verifying a predicted weight change is produced over the 1–2 week window, and logging a weigh-in to confirm predicted-vs-actual is displayed.

**Acceptance Scenarios**:

1. **Given** a user with a series of daily balances over a 1–2 week window, **When** they view their weight trend, **Then** the system displays a predicted weight change computed as cumulative balance ÷ 7700 (kcal per kg), applied to their current weight, clearly labeled as a directional estimate rather than a precise or medical figure.
2. **Given** a user logs an actual weigh-in on a given date, **When** the system has a predicted weight for that same date, **Then** it displays the predicted value alongside the actual logged value and the delta between them.
3. **Given** a user who has not yet logged enough days of data to fill a prediction window, **When** they view the trend feature, **Then** the system indicates that insufficient data exists yet rather than showing a misleading prediction.

---

### Edge Cases

- What happens when a barcode is scanned but doesn't decode successfully (unreadable/damaged barcode)? System should allow the user to retry or fall through to manual entry.
- What happens when Open Food Facts or USDA FoodData Central is unreachable or times out? System should inform the user and offer manual entry rather than blocking the log attempt.
- What happens when a user's voice recording is silent, unintelligible, or in a language/dialect the transcription cannot parse? User sees an empty or garbled transcript to edit, or can abandon and switch to manual entry.
- What happens when a user enters a non-numeric value in a manual entry's calorie or macro field? Save is rejected with a validation message; name field is required.
- What happens when a user logs zero grams or a negative gram amount for a food item? Entry should be rejected as invalid.
- What happens when a user has no food logs at all for a given day? Daily balance shows zero calories consumed against baseline expended.
- What happens when a user changes their timezone after already having logged data? Historical day-boundary groupings are not expected to be retroactively recalculated; new logs use the updated timezone going forward.
- What happens when a user logs a weigh-in for a date outside any existing prediction window? The system shows the actual weight without a predicted-vs-actual comparison for that date.
- What happens when the same food item barcode is scanned multiple times across different users? Each user's log entry is independent; the underlying Open Food Facts product data is shared/read-only across users, while manual (local) food items remain private per user.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a new user to sign up via system (email/password) or Google OAuth.
- **FR-002**: System MUST collect age, sex, height, current weight, goal weight, and activity level during onboarding.
- **FR-003**: System MUST capture the user's timezone at signup or from the browser, for use in day-boundary calculations.
- **FR-004**: System MUST compute a BMR using the Mifflin-St Jeor equation (sex-specific formula) from the user's onboarding data.
- **FR-005**: System MUST compute TDEE as BMR × a non-exercise (sedentary-to-light) activity multiplier, and MUST NOT apply an exercise-inclusive multiplier, to avoid double-counting exercise calories that are logged separately.
- **FR-006**: System MUST recalculate the user's baseline (BMR/TDEE) whenever the user updates their weight, height, or age.
- **FR-007**: System MUST merge a system (email/password) account and a Google account into a single user record when they share the same, verified email address, rather than creating duplicate accounts.
- **FR-008**: System MUST NOT merge a Google account into a system account whose email has not yet been verified.
- **FR-009**: System MUST allow a user to log a food item by scanning a barcode, decoding it client-side, and looking it up against Open Food Facts.
- **FR-010**: System MUST determine whether a barcode lookup found a real product by checking the response body's status/data field, not solely the HTTP status code, to avoid logging an empty result as a real match.
- **FR-011**: System MUST allow a user to log a food item by recording speech, transcribing it, and matching parsed food terms against USDA FoodData Central.
- **FR-012**: System MUST show the transcribed voice text to the user for edit/confirmation before it is used to search for matching foods.
- **FR-013**: System MUST present multiple candidate food matches from a voice-driven search for the user to choose from, and MUST NOT automatically select a top match without user confirmation.
- **FR-014**: System MUST allow a user to manually create a food item (name, calories per 100g, and macros) when no match is found via barcode or voice, or directly by choice.
- **FR-015**: System MUST validate manually entered food items for correct data types (e.g., calorie/macro fields numeric, name required) before saving, without validating the factual accuracy of the values.
- **FR-016**: System MUST scope manually created food items privately to the user who created them.
- **FR-017**: System MUST calculate calories for a logged food entry as `(nutrient per 100g ÷ 100) × grams entered`, using grams as the only supported unit.
- **FR-018**: System MUST require every food log entry to be tagged with exactly one meal category: Breakfast, Lunch, Dinner, or Snacks.
- **FR-019**: System MUST allow a user to optionally log calories burned from exercise for a given day, defaulting to zero when not entered.
- **FR-020**: System MUST calculate a daily calorie balance as calories consumed minus calories expended (baseline TDEE plus any logged exercise burn for that day).
- **FR-021**: System MUST compute "daily" totals using midnight-to-midnight boundaries in the user's local timezone, storing underlying timestamps in UTC.
- **FR-022**: System MUST compute a predicted weight change over a 1–2 week window as cumulative daily balance ÷ 7700 (kcal per kg), applied to the user's current weight.
- **FR-023**: System MUST present all weight predictions as directional, non-clinical estimates rather than precise or medical figures.
- **FR-024**: System MUST allow a user to log an actual weigh-in (weight and date) at any time, with no fixed cadence required.
- **FR-025**: System MUST compare a logged weigh-in against the predicted weight for that same date and display the delta between predicted and actual, when a prediction exists for that date.
- **FR-026**: System MUST persist meal logs, weigh-ins, and exercise-burned entries per user, each tied to a date, to support history review and trend calculation.
- **FR-027**: System MUST enforce referential integrity between users and their food logs, weigh-ins, exercise logs, and local food items at the database level.
- **FR-028**: System MUST compute all business-logic calculations (BMR/TDEE, daily balance, weight prediction, day-boundary math) on the backend as the single source of truth, not duplicated in the client.

### Key Entities

- **User**: A registered account holder; holds authentication identity (system and/or linked Google), email verification status, and timezone.
- **User Baseline**: One current baseline per user — age, sex, height, current weight, goal weight, activity level, and computed BMR/TDEE; recalculated on relevant profile changes.
- **Food Log Entry**: A single logged instance of a food eaten by a user — references a food item (from Open Food Facts, USDA FoodData Central, or the user's local items), grams entered, computed calories/macros, assigned meal category, and date/time.
- **Local Food Item**: A user-created food definition (name, calories per 100g, macros) used when no external match exists; private to the user who created it.
- **Weigh-In**: A user-logged actual body weight tied to a specific date, used to compare against predicted weight for that date.
- **Exercise Log Entry**: An optional, user-logged amount of calories burned from exercise for a specific date.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can complete signup and onboarding (producing a computed baseline) in under 3 minutes.
- **SC-002**: A user logging a packaged food item with a readable barcode can complete that log entry (scan through saved) in under 20 seconds when the product exists in Open Food Facts.
- **SC-003**: Every daily calorie total displayed to a user reflects all of that user's food log entries falling within that calendar day in their own local timezone, with no entries dropped or double-counted.
- **SC-004**: A user with at least one full week of logged daily balances can view a predicted weight trend for the 1–2 week window without needing to perform any manual calculation themselves.
- **SC-005**: For every weigh-in a user logs on a date that falls within an existing prediction window, the predicted-vs-actual comparison is shown alongside it.
- **SC-006**: A user who fails to find a matching food via barcode or voice can complete a manual entry for that item without leaving the logging flow.
- **SC-007**: The complete running application incurs no recurring subscription or usage fees at single-user, portfolio-demo traffic levels.

## Assumptions

- Meal category is selected manually by the user at log time; automatic category suggestion based on time of day is deferred and out of scope for this specification.
- Voice transcription accuracy for Egyptian Arabic dialect is unvalidated; the app always requires user confirmation of transcribed text regardless of accuracy, which mitigates the risk either way. A fallback transcription approach may be substituted later without changing this specification's behavior (user always reviews/edits text before it's used).
- Household unit conversion (cups, pieces, etc.) is out of scope; v1 supports gram entry only.
- Automatic portion/gram estimation from any input source (photo, voice, etc.) is out of scope; the user always enters grams manually.
- Photo-based food recognition (computer vision) is explicitly out of scope.
- The prediction window is 1–2 weeks; the exact length within that range is an implementation detail left open by this specification.
- A user must have an established baseline before a daily balance or weight prediction can be shown; the system is expected to indicate missing prerequisites rather than show incorrect figures.
- Existing account linking depends on email verification status; unverified system-account emails are not eligible for automatic merging with a Google account of the same address.
