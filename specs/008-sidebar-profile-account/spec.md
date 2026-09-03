# Feature Specification: Sidebar Profile Entry & Account/Settings Page

**Feature Branch**: `008-sidebar-profile-account`

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "I need to add a Profile/Account section to the existing sidebar navigation... Add a fixed Profile/Account entry point at the BOTTOM of the existing sidebar (below the 'Goals' nav item, pinned to the bottom of the viewport)... clicking it opens a dropdown (Profile/Account, Settings, Log out)... navigate to an Account/Settings page structured into grouped sections: ACCOUNT, PREFERENCES, APPEARANCE (functional light/dark toggle), NOTIFICATIONS, SUPPORT, ABOUT, LOG OUT... reuse existing components/styles, match the existing dark theme design system, and keep it responsive." Clarified: build full, working backend support for every listed item (not just a UI shell), and replace the sidebar's existing standalone "Log out" button with the new Profile block (Log out moves into its dropdown).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One entry point for profile actions (Priority: P1)

As a signed-in user, I want a single, clearly-identifiable profile entry at the bottom of the sidebar — my avatar and name — that opens a small menu for Account, Settings, and Log out, so I don't have to hunt for account actions or lose the "Goals" nav item to make room for them.

**Why this priority**: This is the entry point every other story depends on — without it, nothing else in this feature is reachable, and it directly replaces the app's current, oddly-placed standalone logout button.

**Independent Test**: Sign in, confirm the sidebar shows the avatar+name block pinned below "Goals" (not scrolling with the nav list) and that the old standalone Log out button is gone; click the block, confirm a dropdown with Profile/Account, Settings, and Log out (visually separated) appears anchored above it; click outside to confirm it closes; click Log out to confirm it still signs the user out exactly as before.

**Acceptance Scenarios**:

1. **Given** the user is signed in and viewing any page with the sidebar visible, **When** the page loads, **Then** a profile block (avatar + display name) is pinned to the bottom of the sidebar, visually separate from the scrollable nav list, and the old standalone Log out button no longer appears.
2. **Given** the profile block is visible, **When** the user clicks anywhere on it, **Then** a dropdown menu opens directly above it (anchored to the sidebar, not a full-screen overlay) listing "Profile/Account", "Settings", and "Log out", with "Log out" visually separated from the other two (e.g. a divider).
3. **Given** the dropdown is open, **When** the user clicks outside it or presses Escape, **Then** it closes without navigating anywhere.
4. **Given** the dropdown is open, **When** the user clicks "Log out", **Then** the user is signed out exactly as the previous standalone Log out button did (session cleared, redirected to login).
5. **Given** the user has no profile photo set, **When** the profile block renders, **Then** it shows a circular avatar with the user's initials on a colored background instead of a broken image.
6. **Given** the user is on a small/mobile screen where the sidebar is collapsed into a bottom tab bar, **When** they look for account actions, **Then** an equivalent profile entry (tappable, opening the same menu) is reachable from the mobile layout — it is not sidebar-only.

---

### User Story 2 - Functional light/dark appearance toggle (Priority: P1)

As a user, I want to switch the app between dark and light appearance from the Settings page, and have my choice remembered the next time I open the app, so I can use the app comfortably in different lighting conditions.

**Why this priority**: Explicitly called out as needing to be genuinely functional, not cosmetic — and it's a visible, testable piece of value independent of the rest of the settings content.

**Independent Test**: Open the Account/Settings page, toggle Appearance to Light, confirm the whole app (not just the settings page) switches to a light color scheme immediately; reload the page and confirm it stays Light; sign out and back in (or open in a new tab) and confirm the preference still holds.

**Acceptance Scenarios**:

1. **Given** the Account/Settings page is open, **When** the user switches the Appearance control from Dark to Light, **Then** the entire app's color scheme changes immediately, without a page reload.
2. **Given** the user has chosen Light appearance, **When** they reload the page or navigate to a different page, **Then** the app continues to render in Light appearance.
3. **Given** the user has chosen Light appearance on one device/browser, **When** they log in from a different browser or after clearing local browser data, **Then** the app falls back to matching their operating system's light/dark setting (their explicit choice is remembered per account where possible, and per-browser otherwise — see Assumptions).
4. **Given** the user has never made an explicit choice, **When** they first load the app, **Then** it defaults to matching their operating system's current light/dark setting, falling back to the existing dark theme if that can't be detected.

---

### User Story 3 - Manage core account details (Priority: P1)

As a user, I want to update my display name and profile photo, change my password, and see whether my Google account is linked, all from one Account section, so I can keep my profile accurate and my account secure without contacting support.

**Why this priority**: This is the substantive "Account" content the user asked for by name, and — along with password change — is the most security-relevant part of the feature.

**Independent Test**: Open Account, change the display name and save, confirm it's reflected in the sidebar profile block immediately; upload a new photo and confirm the avatar updates everywhere it's shown; change the password using the current password and confirm the new password works on next login; confirm the linked-accounts row correctly shows whether Google is connected.

**Acceptance Scenarios**:

1. **Given** the Account section, **When** the user edits their display name and saves, **Then** the new name is persisted and immediately reflected in the sidebar profile block.
2. **Given** the Account section, **When** the user uploads a new profile photo (a supported image type, under the size limit), **Then** it replaces the initials avatar everywhere the avatar is shown.
3. **Given** the user attempts to upload a file that isn't a supported image type or exceeds the size limit, **Then** the upload is rejected with a clear message and the previous avatar is unchanged.
4. **Given** the user has a password set on their account, **When** they enter their correct current password and a new password meeting the app's password rules, **Then** the password is changed and they can log in with the new password afterward.
5. **Given** the user enters an incorrect current password, **When** they attempt to change their password, **Then** the change is rejected with a clear error and the old password remains valid.
6. **Given** the user signed up via Google and has no password set, **When** they view the Account section, **Then** the change-password control communicates that no password is set (rather than silently failing) and offers to set one instead of "changing" one.
7. **Given** the Account section, **When** it loads, **Then** it shows whether a Google account is linked, and if not linked, offers to link one; if linked and the user also has a password set, offers to unlink it.
8. **Given** the user's Google account is their only sign-in method (no password set), **When** they attempt to unlink it, **Then** the action is blocked with an explanation, to prevent the user from locking themselves out.

---

### User Story 4 - Units and language preferences (Priority: P2)

As a user, I want to choose whether weights are shown in kilograms or pounds, and pick my preferred language, so the app matches how I actually think about my data.

**Why this priority**: Useful personalization but lower stakes than identity/security (Story 3) or the entry point itself (Story 1) — the app functions correctly without it.

**Independent Test**: Open Preferences, switch units from kg to lb, confirm weight values already shown elsewhere in the app (e.g. the Goals/baseline page) redisplay in pounds; switch back and confirm they return to kilograms; confirm the choice persists across a reload.

**Acceptance Scenarios**:

1. **Given** the Preferences section, **When** the user switches the units toggle from kg to lb (or back), **Then** the choice is saved and weight values shown elsewhere in the app are converted and displayed in the newly selected unit, without changing the underlying stored values.
2. **Given** the Preferences section, **When** the user picks a different language from the language control, **Then** their choice is saved for next time; if the app does not yet have translated content for that language, the interface communicates that clearly rather than silently staying in the original language (see Assumptions on language scope).

---

### User Story 5 - Support and About information (Priority: P3)

As a user, I want a way to send feedback or get help, and to see what version of the app I'm using along with its legal terms, so I have a path to support and transparency without leaving the app.

**Why this priority**: Lowest-risk, mostly static content — valuable for completeness but not core to daily use of the tracker.

**Independent Test**: Open Support, trigger the Feedback action and confirm it opens a way to send feedback (form or pre-filled email); open Help Center and confirm it navigates somewhere useful. Open About and confirm it shows a version string and working links to Terms of Service and Privacy Policy.

**Acceptance Scenarios**:

1. **Given** the Support section, **When** the user selects "Feedback", **Then** a simple feedback path opens (an in-app form or a pre-addressed email draft) they can use to send a message.
2. **Given** the Support section, **When** the user selects "Help Center", **Then** they are taken to a help resource.
3. **Given** the About section, **When** it renders, **Then** it shows the app's current version, and working links to its Terms of Service and Privacy Policy.

---

### Edge Cases

- What happens if the user clicks the profile block while another dropdown/menu elsewhere in the app is open? The other one should close (only one such menu open at a time).
- What happens if the user's display name or email is very long? The sidebar profile block truncates it (e.g. with an ellipsis) rather than breaking the layout.
- What happens if the photo upload is interrupted (e.g. network drops mid-upload)? The user sees an error and the previous avatar remains in place — no partial/broken image is shown.
- What happens if the user navigates directly to the Account/Settings URL without going through the dropdown (e.g. a bookmark)? The page loads normally like any other protected page.
- What happens if the theme preference conflicts between the operating system's setting and the user's saved choice? The user's explicit saved choice always wins over the OS setting once one has been made.
- What happens if a user without a password (Google-only) tries to use "change password"? Per Story 3 Scenario 6, they're offered to set an initial password instead of being shown a broken "change" flow.
- What happens if the user is on the last available sign-in method and tries to unlink it? Blocked, per Story 3 Scenario 8.
- What happens to the Preferences/Appearance choices if the user is logged out and back in on a different device? Choices tied to the account (units, language, and appearance where the account-level save succeeded) follow the user across devices; a purely local fallback (e.g. offline-first appearance default) is device-specific, per Story 2 Scenario 3.

## Requirements *(mandatory)*

### Functional Requirements

**Sidebar entry point**

- **FR-001**: The sidebar MUST show a profile block (avatar + display name) pinned to the bottom of the viewport, below the existing nav items, and outside the scrollable nav list.
- **FR-002**: The system MUST remove the existing standalone "Log out" button from the sidebar and from the mobile header, replacing both with the new profile entry point (and its equivalent on mobile).
- **FR-003**: The profile block MUST show the user's uploaded photo when set, or their initials on a colored background otherwise.
- **FR-004**: Clicking/tapping the profile block MUST open a dropdown menu anchored to the block (not a full-screen modal), listing "Profile/Account", "Settings", and "Log out", with "Log out" visually separated from the other two options.
- **FR-005**: The dropdown MUST close when the user clicks outside it, presses Escape, or selects one of its options.
- **FR-006**: "Profile/Account" and "Settings" MUST both navigate to the same Account/Settings page (they are two labels for one destination).
- **FR-007**: "Log out" MUST perform the same sign-out behavior as the sidebar's previous standalone Log out button.
- **FR-008**: The profile entry point MUST remain reachable and usable on small/mobile screens where the sidebar itself is not shown.

**Account/Settings page structure**

- **FR-009**: The Account/Settings page MUST be organized into distinct, clearly labeled sections in this order: Account, Preferences, Appearance, Support, About, and Log out — each visually separated (its own card/panel) and using the app's existing uppercase section-header style.
- **FR-010**: Rows within each section MUST use a label-left, value/control-right layout consistent with existing list rows elsewhere in the app.
- **FR-011**: The Log out action MUST also be reachable directly from the bottom of the Account/Settings page itself, styled distinctly (e.g. muted/warning color) to signal it's a destructive/exit action.
- **FR-012**: The page MUST visually match the app's existing dark theme, card styling, and typography without introducing new colors, fonts, or component styles beyond what Appearance mode requires (see FR-017, FR-018).

**Account section**

- **FR-013**: Users MUST be able to view and edit their display name, with the change reflected immediately in the sidebar profile block after saving.
- **FR-014**: Users MUST be able to upload a profile photo (common image formats, within a defined size limit) that replaces their initials avatar everywhere it's shown; invalid uploads (wrong type, too large) MUST be rejected with a clear message and leave the existing avatar unchanged.
- **FR-015**: Users with a password on their account MUST be able to change it by providing their current password and a new password meeting the same rules used at signup; an incorrect current password MUST be rejected without changing anything. Users without a password (Google-only accounts) MUST instead be offered a path to set an initial password.
- **FR-016**: The Account section MUST show whether a Google account is linked, offer to link one if not, and offer to unlink one if linked — except unlinking MUST be blocked (with an explanation) if it is the account's only sign-in method.

**Appearance**

- **FR-017**: Users MUST be able to switch the app's appearance between Dark and Light via a toggle/segmented control consistent with the app's existing control styles, with the change applied across the whole app immediately (no reload required).
- **FR-018**: The chosen appearance MUST persist across page reloads and future sessions; when the user has never made an explicit choice, the app MUST default to the operating system's current light/dark preference, falling back to the existing dark theme if that preference can't be detected.

**Preferences**

- **FR-019**: Users MUST be able to choose their preferred weight unit (kilograms or pounds); once chosen, weight values displayed elsewhere in the app MUST be converted for display without altering the underlying stored values.
- **FR-020**: Users MUST be able to choose a preferred language from a defined list of supported languages; the choice MUST persist, and if the chosen language isn't yet fully supported by app content, that MUST be communicated rather than silently ignored.

**Support & About**

- **FR-021**: Users MUST be able to initiate sending feedback (an in-app form or a pre-addressed email) from the Support section.
- **FR-022**: Users MUST be able to reach a Help Center resource from the Support section.
- **FR-023**: The About section MUST display the app's current version number and working links to its Terms of Service and Privacy Policy.

**Cross-cutting**

- **FR-024**: All settings changes MUST only affect the signed-in user's own account/preferences — no user can view or change another user's profile, password, avatar, or preferences.
- **FR-025**: None of this feature's changes MUST alter the existing Dashboard, Log food, Progress, or Goals pages' content, layout, or behavior, or the existing "Home", "Log food", "Progress", "Goals" nav items' visible labels/positions — except that the Goals page's URL and API path MUST be renamed away from "profile" (they currently collide in name with this feature's own Account/Profile concept) so the two are unambiguously separate; this is a naming-only change with no effect on what the Goals page shows or does.

### Key Entities

- **User Profile (extends existing account)**: Adds a display name (distinct from the existing login username/email), an avatar photo, and a units preference, a language preference, and an appearance preference — all owned by and unique to one user account.
- **Linked Sign-in Method**: Represents whether a given external sign-in provider (Google) is connected to the account, alongside whether a password is also set — used to prevent removing the last remaining way to sign in.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can reach Account/Settings from anywhere in the app (desktop or mobile) in two clicks/taps or fewer.
- **SC-002**: Switching appearance mode visibly changes the entire app in under 1 second, with no reload, and the choice survives a full page reload 100% of the time.
- **SC-003**: A user can update their display name and see it reflected in the sidebar without navigating away from the Account/Settings page.
- **SC-004**: A user can change their password and successfully log in with the new one on the very next login attempt.
- **SC-005**: Zero existing pages (Dashboard, Log food, Progress, Goals) or their nav items show any behavioral or visual regression after this feature ships.
- **SC-006**: Users on a small/mobile screen can reach the same profile menu and every settings capability available on desktop.

## Assumptions

- "Full build" means real, working backend support for every listed capability (profile name/photo, password change, linked-account status, units/language/appearance preferences) — not placeholder or "coming soon" UI — but the exact storage mechanism for uploaded photos and preference data is a technical decision left to the planning phase.
- A Notifications section/preference is explicitly out of scope for this feature (removed by request) — the app sends no push or email reminders today, and none are being added here.
- "Language" support means the preference itself is captured and saved and the app communicates when a chosen language isn't yet translated; translating the entire app's UI text into multiple languages is out of scope for this feature (a follow-up concern once a language is selected).
- Units preference changes only how weight values are *displayed*; it does not migrate or change how weights are stored, matching how the rest of the app already treats units.
- "Linked accounts" in scope means Google only, matching the app's existing Google sign-in support; adding new third-party sign-in providers is out of scope.
- Appearance preference is saved to the user's account when they're signed in (so it follows them across devices/browsers where possible) with a client-side fallback for the brief window before that preference has loaded, or if it can't be reached.
- The feedback path (Support section) does not require building a full ticketing/support system — a simple in-app form that sends an email, or a `mailto:` link, satisfies the requirement.
- Terms of Service and Privacy Policy content itself (the legal text) is out of scope for this feature to author from scratch; the About section links to wherever that content lives (existing static pages, or placeholders if none exist yet).
- "Photo" upload accepts common web image formats (e.g. JPEG, PNG, WebP) under a reasonable size cap (e.g. a few megabytes); no image editing/cropping tool is required beyond accepting the uploaded file as-is. Photos are stored with a third-party image hosting/CDN service rather than in the app's own database — a technical choice with no effect on the user-facing upload/display behavior described above.
- The Goals page (currently reachable at a URL and API path both literally named "profile") is renamed to a "goals"-named URL and API path as part of this feature, purely to remove the naming collision with this feature's own Account/Profile concept — its content, data, and behavior are untouched (FR-025).
