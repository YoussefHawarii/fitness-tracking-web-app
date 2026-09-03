# Feature Specification: Dashboard History Calendar & Time-Aware Greeting

**Feature Branch**: `006-dashboard-history-greeting`

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "i want to make an update in the dashboard page which is to add calendar to check the days history in case i want to see what i ate yesterday and how many calories i take and also for the exercises to check it, also i want this GOOD MORNING word in the home page to be a dynamic one so depends on the time zone it should know either to show good morning or good afternoon"

## Clarifications

### Session 2026-08-31

- Q: How should the Dashboard remember which day you were viewing when you navigate away (e.g. to Log Food) and come back? → A: Session storage — remembered for as long as the browser tab stays open (survives navigating to other pages and back within that tab), resets to today on a fresh tab/browser session; not reflected in the URL.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse a past day's food and calories from the Dashboard (Priority: P1)

A user who forgot what they ate yesterday (or any earlier day) opens the Dashboard, picks that date from a calendar, and sees the food items they logged that day along with the total calories consumed — without having to remember the date format or dig through a separate page.

**Why this priority**: This is the core of the request. Today the Dashboard only ever shows "today" (hardcoded to the browser's current date); there is no way to look back at any prior day at all. This is the single biggest gap and delivers value on its own.

**Independent Test**: Can be fully tested by logging food on a prior day (or using an existing past entry), opening the Dashboard, selecting that date on the calendar, and confirming the food list and calorie total shown match what was actually logged for that date.

**Acceptance Scenarios**:

1. **Given** the user is on the Dashboard, **When** they open the calendar and select yesterday's date, **Then** the Dashboard shows the food items logged yesterday and the total calories consumed that day.
2. **Given** the user has selected a past date, **When** the data finishes loading, **Then** the Dashboard clearly indicates which date is being displayed (it does not look like "today").
3. **Given** the user has selected a past date with no food logged at all, **When** the data loads, **Then** the Dashboard shows an empty/zero state for that day rather than an error or stale data from a different day.
4. **Given** the user is viewing a past date, **When** they select "today" again (or a clearly-provided way back), **Then** the Dashboard returns to showing live, current-day data.
5. **Given** the user is viewing a past date, **When** they navigate away to another page (e.g. to log food) and then return to the Dashboard within the same browser tab, **Then** the Dashboard still shows the same past date they were viewing, not today.

---

### User Story 2 - Browse a past day's exercise history from the Dashboard (Priority: P1)

The same user also wants to see which exercises they logged (sport, duration, calories burned) on that same past day, alongside the food data, so they get the full picture of a prior day in one place.

**Why this priority**: Explicitly requested alongside food history and answers the same underlying need ("what did I do that day"). Sharing the same date-selection UI as User Story 1 makes this cheap to deliver once the calendar exists, and splitting it out would fragment a single mental task across two controls.

**Independent Test**: Can be fully tested by logging an exercise session on a prior day, opening the Dashboard, selecting that date, and confirming the exercise sessions and calories burned shown match what was actually logged.

**Acceptance Scenarios**:

1. **Given** the user has selected a past date on the Dashboard calendar, **When** the data loads, **Then** the Dashboard shows the exercise sessions logged that day (sport, duration, calories burned) and the day's total calories burned.
2. **Given** a past date with food logged but no exercise (or vice versa), **When** the data loads, **Then** each section reflects its own data independently (no cross-contamination or forced empty state on the other section).

---

### User Story 3 - Greeting reflects the user's own time of day (Priority: P3)

A user opens the app and sees a greeting ("Good morning" / "Good afternoon" / "Good evening") that matches the time of day where they actually are, consistently, regardless of which device or browser they use.

**Why this priority**: Lowest priority — it's a small polish item independent of the history/calendar work and does not block or depend on it. The app already computes a time-based greeting, so this is a refinement (making it consistent per-user) rather than new functionality.

**Independent Test**: Can be fully tested by setting a user's account timezone to somewhere with a different local hour than the test device's system clock, loading the Dashboard, and confirming the greeting matches the hour in the account's timezone rather than the device's.

**Acceptance Scenarios**:

1. **Given** a user whose account timezone's local time is currently before noon, **When** they load the Dashboard, **Then** they see "Good morning" even if their device's system clock reports a different hour.
2. **Given** a user whose account timezone's local time is between noon and 6pm, **When** they load the Dashboard, **Then** they see "Good afternoon".
3. **Given** a user whose account timezone's local time is 6pm or later, **When** they load the Dashboard, **Then** they see "Good evening".

---

### Edge Cases

- What happens when the user picks a future date on the calendar? The calendar does not allow selecting dates after today.
- How far back can a user navigate? History is available back to the user's account creation date (or the earliest logged entry, whichever is meaningful); dates with no data simply show an empty state.
- What happens if food/exercise data for the selected past date is still loading? The Dashboard shows a loading state and does not show the previous date's data while waiting.
- What happens if fetching the selected date's data fails (network/server error)? The Dashboard shows an error message for that date and offers a way to retry, without silently falling back to another day's data.
- What happens when the user's timezone offset means "today" straddles midnight differently between their device and their account setting? The calendar's date boundaries and the greeting both follow the account timezone, matching how daily totals are already calculated server-side, so the displayed "today" is consistent regardless of device.
- What happens when the user navigates away from the Dashboard (to any other page) while viewing a past date, then returns? The Dashboard shows the same past date again, not today — the selection is remembered for the rest of that browser tab's session (see Clarifications).
- What happens when the user closes the tab (or opens the app in a new tab) after having selected a past date? The remembered selection does not carry over — the Dashboard starts back on today, since the persistence is scoped to the browser tab's session, not saved permanently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Dashboard MUST provide a calendar control that lets users select any date up to and including today.
- **FR-002**: The Dashboard MUST NOT allow selecting a date later than today.
- **FR-003**: When a past date is selected, the Dashboard MUST display the food items logged on that date and the total calories consumed that date.
- **FR-004**: When a past date is selected, the Dashboard MUST display the exercise sessions logged on that date (sport, duration, calories burned) and the total calories burned that date.
- **FR-005**: The Dashboard MUST visibly indicate which date's data is currently displayed at all times.
- **FR-006**: The Dashboard MUST provide a way to return to viewing the current day's live data after browsing a past date.
- **FR-007**: A selected date with no logged food and/or no logged exercise MUST show a clear empty state for that section rather than an error or leftover data from another date.
- **FR-008**: A failure to load a selected date's data MUST show an error state with a retry option, scoped to the section that failed, without discarding a successfully-loaded sibling section.
- **FR-009**: Selecting a new date MUST replace the previously displayed data (not merge or append it).
- **FR-010**: Date range calculations for a selected day (what counts as "that day") MUST be based on the user's account timezone, consistent with how daily totals are already computed for calorie balance and exercise logs.
- **FR-011**: The Dashboard's greeting MUST be computed from the current time in the user's account timezone rather than the device's local clock.
- **FR-012**: The greeting text MUST be "Good morning" before 12:00, "Good afternoon" from 12:00 up to 18:00, and "Good evening" from 18:00 onward, in the user's account timezone.
- **FR-013**: The Dashboard MUST remember the user's selected date for the remainder of the current browser tab session, so that navigating to another page and back (e.g. to log food) restores the same selected date instead of resetting to today; this memory MUST NOT persist beyond that tab's session (a new tab or a fresh browser session starts back on today).
- **FR-014**: The primary navigation control that links to the Dashboard MUST be labeled "Home" rather than "Today", since the Dashboard is no longer a today-only view.

### Key Entities

- **FoodLogEntry** *(existing)*: A single food item a user logged, with a timestamp and computed calories; queried and totaled per calendar day for display.
- **ExerciseLogEntry** *(existing)*: A single exercise session a user logged, with a date, sport, duration, and computed calories burned; queried and totaled per calendar day for display.
- **User account timezone** *(existing)*: The IANA timezone already stored on the user's account, used to determine day boundaries and local time of day; this feature reuses it for the calendar's "today" boundary and for the greeting instead of introducing a new setting.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can view any past day's food and exercise history within 2 clicks/taps from the Dashboard (open calendar, pick date).
- **SC-002**: Selecting a past date and seeing that day's food and exercise data displayed takes under 2 seconds under normal network conditions.
- **SC-003**: 100% of past-date views show data consistent with what was actually logged for that date (no off-by-one-day mismatches caused by timezone handling).
- **SC-004**: The greeting shown matches the correct time-of-day period (morning/afternoon/evening) for the user's account timezone in 100% of loads, independent of the device's system clock or locale.

## Assumptions

- "The dashboard page" and "the home page" referenced in the request are the same screen (the app's single post-login landing page, `Dashboard`); there is no separate "home" page distinct from the dashboard.
- History browsing reuses the existing food and exercise data already collected via logging features (001, 004, 005); this feature does not introduce new logging capabilities, only a way to view past logged data.
- No new backend data is required for date-range history: existing per-date food and exercise endpoints are assumed sufficient, since they already accept a date parameter (only now driven by a user-picked date instead of always "today").
- The user's account timezone (already stored for calorie-balance day-boundary math) is reused as the single source of truth for both the calendar's date boundaries and the greeting's time-of-day, rather than introducing a separate timezone concept.
- Editing or deleting entries from a past date is out of scope for this feature; it is a read-only history view. (Existing edit/delete capabilities, if any, are unaffected but not required to be exposed from this history view.)
- Calendar navigation is limited to single-day selection (view one day at a time), not a multi-day range or week/month aggregate view.
