# Feature Specification: Exercise Tracking Page

**Feature Branch**: `004-exercise-tracking-page`

**Created**: 2026-08-30

**Status**: Draft

**Input**: User description: "make exercise data editable so it can be corrected if entered wrong; add a dedicated Exercise page listing sports (swim, football, run, gym/weights, etc.) where the user selects a sport and enters how long they played, calories are calculated automatically, and results are shown on the dashboard"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Log an exercise session by sport and duration (Priority: P1)

A user who just finished a workout goes to the Exercise page, picks the sport they did (e.g. Running) from a list, enters how long they did it for, and the app calculates and saves how many calories they burned — without the user having to know or guess a calorie number themselves.

**Why this priority**: This is the core value of the feature and directly replaces the current free-text "calories burned" field, which requires the user to already know their own calorie burn (something most users can't estimate accurately). Without this, the rest of the feature has nothing to build on.

**Independent Test**: Can be fully tested by opening the Exercise page, selecting a sport, entering a duration, saving, and confirming a new entry appears with a plausible calculated calorie value and today's date.

**Acceptance Scenarios**:

1. **Given** the user is on the Exercise page, **When** they select "Running" and enter 30 minutes and save, **Then** a new exercise entry is created for today showing the sport, duration, and an automatically calculated calorie value.
2. **Given** the user has entered a duration of 0 or left it blank, **When** they try to save, **Then** the app rejects the entry and explains that a valid duration is required.
3. **Given** the user has not completed onboarding (no baseline weight on file), **When** they try to log an exercise session, **Then** the app tells them a baseline is required before calories can be calculated, instead of saving an incorrect entry.

---

### User Story 2 - Edit a previously logged exercise entry (Priority: P1)

A user notices they logged the wrong sport or duration (e.g. they meant 20 minutes, not 200) and wants to correct the existing entry rather than delete and recreate it.

**Why this priority**: This is the specific complaint that started this feature request — the user found no way to correct a mistake. It's equally critical to the ability to log in the first place, since an app where mistakes can't be fixed erodes trust in the tracked data.

**Independent Test**: Can be fully tested by creating an exercise entry, opening it for edit, changing the sport and/or duration, saving, and confirming the entry (and its calculated calories) updates in place rather than creating a duplicate.

**Acceptance Scenarios**:

1. **Given** an existing exercise entry for today, **When** the user edits its duration, **Then** the entry's calculated calories update to reflect the new duration and the entry keeps its original identity (not duplicated).
2. **Given** an existing exercise entry, **When** the user changes the sport, **Then** the calories recalculate using the new sport's intensity.
3. **Given** an exercise entry belonging to another user, **When** any user attempts to edit it directly, **Then** the app refuses the change.

---

### User Story 3 - Delete a logged exercise entry (Priority: P2)

A user logged a session by mistake (duplicate entry, or a workout that didn't actually happen) and wants to remove it entirely.

**Why this priority**: Complements editing — some mistakes (duplicates, entirely wrong days) are better removed than corrected. Slightly lower priority than edit because most correction needs are covered by editing, but still necessary for full data accuracy.

**Independent Test**: Can be fully tested by creating an exercise entry, deleting it, and confirming it no longer appears in the day's list or contributes to the day's exercise total.

**Acceptance Scenarios**:

1. **Given** an existing exercise entry, **When** the user deletes it, **Then** it disappears from the list and the day's total exercise calories decreases accordingly.
2. **Given** a delete action, **When** the user confirms, **Then** the deletion is permanent with no automatic recovery (consistent with other destructive actions in the app).

---

### User Story 4 - View the day's logged sessions and running total (Priority: P2)

A user wants to see everything they've logged for the day in one place — each session individually, plus the total calories burned from exercise — both on the Exercise page and as a summary on the dashboard.

**Why this priority**: Gives the feature visible payoff and is what makes editing/deleting practical (the user needs a list to act on). Slightly after core logging/editing because those must exist first for a list to have content.

**Independent Test**: Can be fully tested by logging two or more sessions in a day and confirming the Exercise page lists each one individually with sport/duration/calories, and the dashboard's existing "Exercise" figure matches the sum shown on the Exercise page.

**Acceptance Scenarios**:

1. **Given** the user has logged multiple exercise sessions today, **When** they open the Exercise page, **Then** they see each session listed separately (sport, duration, calories), most recent first.
2. **Given** the user has logged exercise sessions today, **When** they view the dashboard, **Then** the dashboard's exercise total matches the sum of today's sessions shown on the Exercise page.
3. **Given** the user has not logged any exercise today, **When** they open the Exercise page, **Then** they see an empty state indicating no sessions logged yet, not an error.

---

### Edge Cases

- What happens when a user selects a sport but enters an extremely long duration (e.g. 24+ hours)? The app should reject implausible durations rather than silently calculating and storing an unrealistic calorie value.
- What happens if the sport catalog doesn't include the exact activity the user did (e.g. a niche sport)? The user selects "Other", types the activity's name, and the app calculates calories using a general/moderate-intensity default so they aren't blocked from logging.
- How does the system handle a user editing an entry to move it to a different day? Out of scope for this feature — entries stay associated with the day they were originally logged; only sport, duration are editable.
- What happens to a user's already-logged exercise entries if their baseline weight changes later? Past entries keep the calorie value calculated at logging time (not retroactively recalculated), consistent with how other historical data in the app is treated as a point-in-time record.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a dedicated Exercise page, separate from the dashboard, for logging, viewing, editing, and deleting exercise sessions.
- **FR-002**: System MUST offer a predefined list of sports/activities to choose from: Football, Swimming, Padel, Basketball, Gym/Weight Training, Running, Tennis, and a general "Other" option — each (except "Other") with an associated calorie-burn intensity used for calculation.
- **FR-002a**: When the user selects "Other", the system MUST let them type in the name of the sport/activity they did (free text), and MUST calculate calories using a general/moderate-intensity default, since no specific intensity is known for an arbitrary typed sport.
- **FR-003**: Users MUST be able to log a new exercise session by selecting a sport and entering a duration; the system MUST calculate the calories burned automatically from the sport's intensity, the entered duration, and the user's baseline body weight.
- **FR-004**: System MUST reject logging or editing when no duration is provided, the duration is zero/negative, or the duration exceeds a sane maximum (24 hours), with a clear explanation to the user.
- **FR-005**: System MUST prevent logging an exercise session for a user who has not yet completed onboarding (no baseline on file), since calorie calculation depends on baseline body weight.
- **FR-006**: Users MUST be able to edit the sport and/or duration of a previously logged exercise session they own; on save, the system MUST recalculate and update the stored calorie value for that same entry (no duplicate created).
- **FR-007**: Users MUST be able to delete a previously logged exercise session they own; deletion MUST be permanent and MUST remove the entry from all totals immediately.
- **FR-008**: System MUST prevent a user from viewing, editing, or deleting another user's exercise entries.
- **FR-009**: System MUST display, on the Exercise page, the list of exercise sessions logged for the current day (sport, duration, calculated calories), ordered most recent first.
- **FR-010**: System MUST display, on the Exercise page, the day's total calories burned from exercise as the sum of that day's logged sessions.
- **FR-011**: System MUST continue to show the day's total exercise calories on the dashboard (existing "Exercise" figure), consistent with the total shown on the Exercise page for the same day.
- **FR-012**: System MUST continue to keep exercise calories excluded from the "expended"/"remaining calories" calculation — exercise remains an informational total only, per the existing calorie-balance design (see `docs/business-logic.md` §2), and this feature does not change that.
- **FR-013**: System MUST replace the current free-text "calories burned" quick-entry control on the dashboard with a path into the new sport-based logging flow, so all exercise logging goes through sport + duration rather than a raw calorie number.

### Key Entities

- **Exercise Session (Exercise Log Entry)**: A single logged workout — belongs to one user, has a sport/activity type, a duration, a calculated calorie value, and the date it was logged for. Editable and deletable by its owner only.
- **Sport/Activity**: A predefined activity type (Football, Swimming, Padel, Basketball, Gym/Weight Training, Running, Tennis) with an associated calorie-burn intensity used to calculate calories from duration and body weight, plus a general "Other" option that accepts a free-typed sport name and uses a default moderate intensity. The predefined list itself is not user-editable; a fixed reference list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can log a new exercise session (select sport, enter duration, save) in under 15 seconds, without needing to know or calculate a calorie number themselves.
- **SC-002**: A user can correct a mistaken exercise entry (wrong sport or duration) in under 15 seconds, without deleting and recreating it.
- **SC-003**: 100% of exercise sessions logged through this feature show a calculated calorie value automatically, with zero instances of the user needing to manually type a calorie amount.
- **SC-004**: The exercise total shown on the dashboard always matches the sum of the day's individual sessions shown on the Exercise page (zero discrepancy).
- **SC-005**: Deleting or editing an exercise entry is reflected in both the Exercise page list and the dashboard total without requiring a page reload.

## Assumptions

- Calorie calculation uses a standard, publicly documented estimation method (MET-based: calories = MET value × body weight in kg × duration in hours), consistent with the app's existing use of standard formulas (Mifflin-St Jeor for BMR, per `docs/business-logic.md`) rather than device-measured heart-rate data, which is out of scope.
- The user's most recent baseline body weight (already captured during onboarding) is used for the calculation; the feature does not ask the user to re-enter their weight per session.
- The sport catalog is a fixed, app-defined list for v1 (not user-customizable or admin-manageable); adding new sports later is a follow-up enhancement, not part of this feature.
- Only today's exercise sessions need to be listed/edited/deleted through the Exercise page for v1; a full historical log/calendar view of past days' exercise is out of scope (mirrors how the dashboard's "today" scope already works for consumed/expended calories).
- Duration is entered in minutes; a 24-hour cap is a reasonable sanity bound consistent with how the app already validates other numeric inputs (e.g. gram amounts for food).
- This feature fully replaces the existing free-text "calories burned" quick-entry form on the dashboard (`ExerciseLogForm`) — that control is removed/replaced rather than kept alongside the new page, to avoid two different ways of logging the same data.
