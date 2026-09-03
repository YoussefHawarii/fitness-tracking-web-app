# Feature Specification: Manual Food Log by Name Search

**Feature Branch**: `005-manual-food-log-search`

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "i want to make an update in the food-log page, now when i enter the food manual, it ask me to enter the calories which is something i don't want to do, i just want to enter the food name and grams then the system should recognize this item and know how much calories it has per gram and calculate it, also another thing, i want when i add the item it gives me the option where to save this item, is it as a breakfast or lunch or dinner or snack, so i can choose what ever i want and save it in there."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Log a food by name without knowing its calories (Priority: P1)

A user eating a meal wants to log it by typing the food's name and how many grams they ate. They should not need to know or look up how many calories that food contains — the system should recognize the food from its name and work out the calories for them automatically, based on the amount they ate.

**Why this priority**: This is the core pain point driving the request. Requiring a calorie figure the user doesn't know is a hard blocker to logging food manually at all — it's the difference between a usable feature and one people give up on.

**Independent Test**: Can be fully tested by switching to manual entry, typing a common food name (e.g., "banana"), confirming a recognized match, entering a gram amount, and verifying the logged calories are calculated automatically without the user ever typing a calorie number.

**Acceptance Scenarios**:

1. **Given** the user is on the manual entry tab, **When** they type a food name and search, **Then** the system shows a list of recognized foods matching that name, each identifiable by name (and, if helpful, its calorie density) — with no calorie input field shown to the user at this step.
2. **Given** the user has selected a recognized food match, **When** they enter a gram amount and save, **Then** the entry is logged with calories computed automatically from the food's known calorie density and the entered grams.
3. **Given** the user typed a food name with no recognized match, **When** the search completes, **Then** the system tells them no match was found and offers a way to still log the item (see User Story 3), rather than silently failing.

---

### User Story 2 - Choose which meal the logged item belongs to (Priority: P2)

After identifying what they ate and how much, the user wants to say whether it was breakfast, lunch, dinner, or a snack, and have it saved and grouped under that meal.

**Why this priority**: Important for the food log to stay organized and useful, but it is a smaller usability gap than User Story 1 — the app already supports choosing a meal category for barcode- and voice-sourced entries today, so this story is mainly about confirming/preserving that choice for the manual-entry path once it is redesigned.

**Independent Test**: Can be fully tested by completing a manual food entry (per User Story 1), selecting "Dinner" as the meal, saving, and verifying the item appears under the Dinner group on the food log page with its calories included in the Dinner subtotal.

**Acceptance Scenarios**:

1. **Given** the user has picked a recognized food and entered grams, **When** they reach the save step, **Then** they can choose exactly one of Breakfast, Lunch, Dinner, or Snacks before saving.
2. **Given** the user saved an entry under a chosen meal, **When** they view the food log for that day, **Then** the item appears listed under that meal's section and is included in that meal's calorie subtotal.

---

### User Story 3 - Fall back gracefully when a food isn't recognized (Priority: P3)

Occasionally the food a user ate (a homemade dish, a regional item) won't be recognized by name search. The user still wants a way to log it, even if that means providing calorie information themselves as a last resort.

**Why this priority**: Keeps the feature from being a dead end for unusual foods, but it's a secondary path — most everyday foods are expected to be recognized, so this safety net matters less than the primary flow.

**Independent Test**: Can be fully tested by searching for a made-up food name that returns no matches, confirming a "not found" message appears, and completing the offered fallback path to still log the item.

**Acceptance Scenarios**:

1. **Given** a name search returns no recognized matches, **When** the user chooses the fallback option, **Then** they can create a custom entry for that food (providing its calorie information themselves) and proceed to log it with grams and a meal category exactly as in User Stories 1 and 2.

### Edge Cases

- What happens when the name search returns many matches (e.g., a common ingredient with dozens of variants)? The user must be able to see distinguishing detail (e.g., calorie density per match) and pick the one intended.
- What happens if the user enters 0 or a negative gram amount, or leaves grams blank? The system must reject the entry and prompt for a valid positive amount, same as today.
- What happens if the user searches for a food name but never selects a match before navigating away or clearing the field? No log entry should be created.
- What happens if the calorie-lookup service is temporarily unavailable? The user must see a clear error and be pointed to the fallback (custom entry) path rather than seeing a silent failure.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The manual food entry path MUST let the user identify a food by typing its name — the user MUST NOT be required to enter a calorie value in order to search for or select a food.
- **FR-002**: On searching a typed food name, the system MUST look up recognized foods matching that name and present the matching candidates for the user to choose from.
- **FR-003**: Each presented candidate MUST show enough information (at minimum, its name) for the user to distinguish it from other candidates, and MUST carry the calorie-per-unit-weight data needed to compute a log entry's calories.
- **FR-004**: Once the user selects a candidate food, the system MUST let them enter a gram amount for that food.
- **FR-005**: The system MUST automatically compute the total calories for the logged entry from the selected food's known calorie density and the entered gram amount — the user MUST NOT manually enter or edit this calculated calorie figure.
- **FR-006**: Before saving, the system MUST let the user choose exactly one meal category — Breakfast, Lunch, Dinner, or Snacks — to associate with the entry.
- **FR-007**: On save, the system MUST persist the entry with its source food, computed calories, gram amount, and chosen meal category, and the entry MUST subsequently appear grouped under that meal category on the food log page.
- **FR-008**: If a typed food name returns no recognized matches, the system MUST clearly inform the user and offer a fallback path to still log the food.
- **FR-009**: The fallback path MUST allow the user to supply calorie information themselves for an unrecognized food, and MUST still require a gram amount and a chosen meal category before the entry can be saved.
- **FR-010**: The system MUST reject save attempts with a missing or non-positive gram amount, and MUST prompt the user to correct it.
- **FR-011**: The barcode-scan and voice-logging entry paths MUST continue to work as they do today (both already avoid asking the user for calories directly and already support choosing a meal category) — this feature only changes the manual-entry path.

### Key Entities

- **Food Match**: A recognized food returned by name search; identified by name, with a known calorie density (calories per unit weight) plus optional macro data. Selecting one becomes the basis of a log entry.
- **Custom Food Item**: A food the user defines themselves when no recognized match exists, identified by name with a calorie density the user supplies. Used only via the fallback path.
- **Food Log Entry**: A single logged instance of eating some food — references a Food Match or Custom Food Item, a gram amount, a computed calorie total, a meal category (Breakfast/Lunch/Dinner/Snacks), and a logged time. Displayed grouped by meal category on the food log page.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can log a common food manually — from typing its name to a saved entry — without ever being asked to type or look up a calorie number, for at least 90% of everyday foods searched.
- **SC-002**: Users can complete a manual food log entry (name search through save) in under 30 seconds for a recognized food.
- **SC-003**: 100% of saved food log entries, regardless of entry path (barcode, voice, or manual), carry a user-chosen meal category and appear under the correct meal grouping on the food log page.
- **SC-004**: When a searched food has no recognized match, users can still successfully complete a log entry via the fallback path without getting stuck.

## Assumptions

- Meal-category selection (Breakfast/Lunch/Dinner/Snacks) is already implemented and working for barcode- and voice-sourced entries on the food log page today; this feature preserves that existing behavior and extends the same choice to the redesigned manual-entry path rather than building it from scratch.
- "Recognize this item and know how much calories it has per gram" is satisfied by searching the same recognized food database already used for voice-logged entries (matched by name, returning calorie-per-100g data), rather than a new data source — reusing an existing, proven lookup rather than introducing a second one.
- When a name search returns multiple candidates, the user picks the intended one from a list (matching the existing pattern already used for voice-logged entries) rather than the system auto-selecting a "best" match.
- The existing ability to log a food with self-supplied calorie information is retained only as a fallback for foods that aren't recognized by search, not as the primary manual-entry flow.
- Editing or deleting an already-saved food log entry, and changing a food's meal category after saving, are out of scope for this feature.
