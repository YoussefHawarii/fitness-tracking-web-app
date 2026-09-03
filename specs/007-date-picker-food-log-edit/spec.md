# Feature Specification: Click-to-Open Date Picker & Editable Food Log

**Feature Branch**: `007-date-picker-food-log-edit`

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "i want to make a change in the data picker, now in order to change the data, i have to click on the data icon on the right or type the data my self, i don't want that, i want the all i need to do is just click any where on the data icon and a drop down data picker just pop up and make me choose the data i want. another change as well, i want the food logged in the home page to be dynamically connected with the log food page, it has to show the same food name i entered and how much calories(as it already shows now), and also i want to make it active that when ever i click on the food item it takes me directly to the food log tab to see if i want to make any change, another thing related to that, i want the log food page to has an option for edit and delete for the items i enter, i case i want to correct a grams i entered for an item, or if i choose a wrong item and want to change this or delete it, so make sure that edit and delete icon are available for this one."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One-click date picker (Priority: P1)

As a user viewing my dashboard history, I want to open the calendar picker by clicking anywhere on the date field, so I don't have to hunt for the small calendar icon or type the date manually.

**Why this priority**: This is the first change the user described and is a quick, high-frequency friction point — every time they want to check a past day's log, they hit this.

**Independent Test**: Can be fully tested by opening the dashboard, clicking anywhere inside the date field (not just the calendar icon), and confirming the calendar dropdown appears immediately, letting the user pick a date without typing.

**Acceptance Scenarios**:

1. **Given** the dashboard is showing today's data, **When** the user clicks anywhere inside the date field (the text area, not only the small calendar icon), **Then** the calendar dropdown opens immediately so the user can pick a date.
2. **Given** the calendar dropdown is open, **When** the user selects a date from it, **Then** the dashboard updates to show that date's data and the dropdown closes.
3. **Given** the date field is focused via keyboard (e.g. Tab), **When** the user presses Enter/Space, **Then** the calendar dropdown still opens (keyboard access is not broken by this change).

---

### User Story 2 - Home page food entries link to Food Log for editing (Priority: P2)

As a user, I want the food items shown on my home page to be the same items I logged, and clicking one should take me straight to the Food Log page so I can fix a mistake.

**Why this priority**: Builds directly on the existing (already dynamic) home page food list and turns it into an actionable shortcut into the edit/delete flow being added in User Story 3. It has no value without Story 3, so it is sequenced after it in dependency terms but is the user's second-named request.

**Independent Test**: Can be fully tested by logging a food item, confirming it appears on the home page with the correct name and calories, clicking it, and confirming the app navigates to the Food Log page focused on that day's entries.

**Acceptance Scenarios**:

1. **Given** a food item was logged for the selected day, **When** the home page loads, **Then** the item's name and computed calories shown on the home page match exactly what was entered in the Food Log page.
2. **Given** the home page is showing a logged food item, **When** the user clicks that item, **Then** the app navigates to the Food Log page showing that same entry (for the same date) so the user can edit or delete it.
3. **Given** the home page is showing a past date's food items (via the date picker), **When** the user clicks one of those items, **Then** the Food Log page opens showing entries for that same past date, not today.

---

### User Story 3 - Edit and delete logged food entries (Priority: P1)

As a user, I want edit and delete controls on each food entry in the Food Log page, so I can correct a wrong gram amount or remove an item I logged by mistake.

**Why this priority**: Without this, User Story 2's "click through to fix it" has nothing to do once the user arrives at the Food Log page — this is the core capability being requested and currently has zero support (food logs can only be created, never changed or removed).

**Independent Test**: Can be fully tested by logging a food item, then using the edit control to change its gram amount and confirming the calories recompute, and separately using the delete control to remove an item and confirming it disappears from both the Food Log page and the home page.

**Acceptance Scenarios**:

1. **Given** a logged food entry, **When** the user selects the edit control on it, **Then** the user can change the gram amount (and meal category) and save the change.
2. **Given** an edited gram amount is saved, **When** the entry list refreshes, **Then** the displayed calories (and other computed nutrients) reflect the new gram amount.
3. **Given** a logged food entry, **When** the user selects the delete control and confirms, **Then** the entry is removed and no longer appears in the Food Log page or the home page's food list.
4. **Given** the user opens the edit control, **When** they cancel without saving, **Then** the original entry is unchanged.
5. **Given** the user attempts to save an edit with an invalid gram amount (zero, negative, or non-numeric), **Then** the system rejects the save and shows an error, leaving the original entry intact.

---

### Edge Cases

- What happens if the user tries to delete a food entry that another request has already deleted (e.g. double-click on the delete control, or deleted from another open tab)? The system should show a clear "already removed" message and refresh the list rather than erroring silently.
- What happens if the user clicks a home page food item for a date, then the underlying entry is deleted before the Food Log page finishes loading? The Food Log page should simply show the current (updated) list for that date rather than crashing.
- What happens when there are no food items logged for the selected day? The date picker and click-through behavior are unaffected; the empty state message already shown ("Nothing logged for this day") continues to apply.
- What happens if the user tries to edit an entry's food item/source (not just grams/meal)? Out of scope for this feature — only grams and meal category are editable (see Assumptions).
- What happens on very old browsers where the native calendar dropdown API used to force it open isn't supported? The date field must still fall back to being directly typable/clickable via the icon, matching today's behavior, so users are never left unable to change the date.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The date picker MUST open its calendar dropdown when the user clicks anywhere within the date field's clickable area, not only on the calendar icon.
- **FR-002**: The date picker MUST continue to prevent selecting a future date, and MUST continue to support the existing "Back to today" control, unchanged from current behavior.
- **FR-003**: The date picker MUST remain operable via keyboard (tab to focus, open and choose a date without a mouse).
- **FR-004**: The home page's food list MUST display the exact food name and computed calories as they exist in the corresponding Food Log entries for the currently selected date, staying in sync when entries are added, edited, or deleted.
- **FR-005**: Each food item shown on the home page MUST be clickable/tappable, and clicking it MUST navigate the user to the Food Log page, scoped to the same date the home page was showing.
- **FR-006**: The Food Log page MUST display an edit control and a delete control for every food entry it lists.
- **FR-007**: Selecting the edit control MUST let the user change the entry's gram amount and meal category, and saving MUST recompute and persist the calories and other nutrient values for the new gram amount.
- **FR-008**: The edit flow MUST validate the gram amount (a positive number) before saving, and MUST reject invalid input with a clear message without altering the stored entry.
- **FR-009**: Selecting the delete control MUST ask the user to confirm before removing the entry, and upon confirmation MUST permanently remove that entry from the food log.
- **FR-010**: After an edit or delete completes, the Food Log page's entry list and the home page's food list (when subsequently viewed) MUST reflect the change without requiring a manual page refresh beyond normal navigation.
- **FR-011**: Users MUST only be able to edit or delete their own food log entries.

### Key Entities

- **Food Log Entry**: A single logged food item for a specific date and meal category, with a source item (barcode/USDA/local), gram amount, and computed calories/protein/carbs/fat. This feature adds the ability to modify its gram amount and meal category, or remove it entirely, after creation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can open the date picker's calendar dropdown in a single click, from anywhere on the field, 100% of the time.
- **SC-002**: The food name and calorie value shown for a given entry on the home page match the Food Log page for that entry in every case, with no manual refresh needed.
- **SC-003**: Users can correct a mistaken gram amount on a logged food item in under 15 seconds, without needing to delete and re-add the entire entry.
- **SC-004**: Users can remove an incorrectly logged food item in two actions or fewer (select delete, confirm).
- **SC-005**: Clicking a food item on the home page lands the user on the Food Log page showing that same entry, for the correct date, 100% of the time.

## Assumptions

- Editing a food log entry is limited to its gram amount and meal category; changing the underlying food item/source itself is out of scope — to change the food, the user deletes the entry and logs a new one.
- Delete requires a confirmation step (e.g. a confirm dialog) to prevent accidental data loss, consistent with how irreversible actions are typically handled elsewhere in the app.
- The "click anywhere to open" date picker behavior applies to the existing native date input used in `HistoryDatePicker`; no custom calendar widget/library is being introduced, matching the project's prior decision to use the native control.
- Backend support for editing and deleting a food log entry does not yet exist and must be added, mirroring the existing pattern already used for exercise log entries (which support edit and delete today).
- Clicking a home page food item navigates to the Food Log page for the same date already selected on the home page (today or a past date via the date picker), not always to today.
