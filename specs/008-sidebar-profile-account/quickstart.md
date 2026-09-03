# Quickstart: Sidebar Profile Entry & Account/Settings Page

Manual/e2e validation guide for the six user stories in [spec.md](spec.md).

## Prerequisites

- Backend running (`npm run start:dev` from `Backend/`) with `.env` configured per `Backend/.env.example`, plus a new optional `SUPPORT_EMAIL` var (research.md §7) — falls back to `SMTP_FROM` if unset — and new required `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` vars (research.md §1) for a Cloudinary account/folder to test avatar upload against.
- Frontend running (`npm run dev` from `Frontend/`).
- A signed-in test account. To exercise both password-change paths (Story 3, Scenarios 4–6), test with one account that has a password (signed up via email/OTP) and one Google-only account (no password set).

## Story 1 — Sidebar profile entry point

1. Sign in, land on the Dashboard. Confirm the sidebar shows an avatar (initials, since no photo yet) + display name pinned below "Goals", visually separated from the scrollable nav, and that the old standalone "Log out" button is gone (desktop sidebar and mobile header both).
2. Click the profile block. **Expected**: a dropdown opens anchored above it with "Profile/Account", "Settings", "Log out" — a divider before "Log out".
3. Click outside the dropdown. **Expected**: it closes, no navigation.
4. Open it again and press Escape. **Expected**: it closes.
5. Click "Log out". **Expected**: signed out, redirected to `/login`, same as the old button's behavior.
6. Resize to a mobile viewport (or use a phone). **Expected**: an equivalent profile entry (tap target) is present and opens the same menu, per contracts/`GET /profile/account` powering both surfaces.

## Story 3 — Account section (validated before Story 2's Appearance toggle, since it lives on the same page)

1. Navigate to Account (via the dropdown's "Profile/Account"). Confirm the page shows the ACCOUNT, PREFERENCES, APPEARANCE, NOTIFICATIONS, SUPPORT, ABOUT sections as separate cards, in that order, plus a distinctly-styled Log out row at the bottom.
2. Edit display name, save. **Expected**: sidebar profile block updates immediately without a full page reload.
3. Upload a photo (a normal phone/camera JPEG). **Expected**: the app requests a signed upload payload, uploads directly to Cloudinary, then confirms it with the backend; the new photo (resized/optimized by Cloudinary per research.md §1) replaces the initials avatar in both the Account page and the sidebar. Check the configured Cloudinary account/folder (`avatars/u_<userId>`) and confirm the asset actually landed there.
4. Attempt to upload a non-image file. **Expected**: rejected with a clear message (either by the signed-upload constraints or by Cloudinary itself); avatar unchanged.
4a. Upload a second photo. **Expected**: the previous Cloudinary asset is deleted (no orphaned assets accumulating in the account) and replaced by the new one.
5. (Password-account) Change password with the correct current password. **Expected**: success; log out and log back in with the new password to confirm it took effect.
6. (Password-account) Attempt to change password with a wrong current password. **Expected**: rejected, old password still works.
7. (Google-only account) Open the password control. **Expected**: it reads as "set a password" (not "change"), since `hasPassword` is false; setting one succeeds via `POST /profile/password`.
8. (Password-account, not yet Google-linked) Click "Link Google account", complete the Google prompt. **Expected**: `googleLinked` becomes true; the row now offers "Unlink".
9. (Google-only account, no password) Attempt to unlink Google. **Expected**: blocked with an explanation (would remove the only sign-in method) — per `DELETE /profile/google/link`'s `409`.

## Story 2 — Functional light/dark appearance toggle

1. On the Account page's Appearance section, toggle Light. **Expected**: the whole app (not just this page) switches color scheme within under a second, no reload.
2. Reload the page. **Expected**: still Light.
3. Clear `localStorage` for the site (simulating a new browser) while still logged in server-side, then load the app fresh. **Expected**: since the preference is also stored on the account, the next authenticated load restores Light (a brief flash of the `localStorage`/OS-default fallback before the account loads is acceptable per research.md §3).
4. Log out entirely, clear `localStorage`, and load the login page with the OS set to light mode. **Expected**: defaults to light (no account preference to read pre-auth); with OS set to dark, defaults to dark.

## Story 4 — Units and language preferences

1. On Preferences, switch units to lb. **Expected**: weight values on the Goals (`/profile`) baseline page and Progress (`/weight-trend`) page immediately redisplay converted to pounds; switching back returns them to kilograms. Confirm via `GET /profile/preferences`-backed state that the underlying stored kilogram values haven't changed (e.g. switch back and forth and confirm the number returns to exactly the original figure, not a drifted rounded one).
2. Pick a non-English language from the language control (if more than one is listed) or confirm the control communicates that only English is fully supported today, per FR-020 — whichever the implemented supported-list turns out to be.

## Story 5 — Support and About

1. On Support, fill in the feedback form and submit. **Expected**: `202`-style success message; the configured `SUPPORT_EMAIL` inbox (or `SMTP_FROM` fallback) receives it.
2. Click Help Center. **Expected**: navigates to the configured help resource.
3. On About, confirm a version string renders and the Terms of Service / Privacy Policy links are clickable and go somewhere (real page or the documented placeholder).

## Regression check (FR-025)

- Visit Dashboard, Log food, Progress (`/weight-trend`), and Goals — now at **`/goals`**, not `/profile` (research.md §9) — confirm all four are visually and behaviorally unchanged from before this feature, just reached at the new URL. The sidebar's "Goals" nav item must point at `/goals`.
- Confirm visiting the old `/profile` URL directly no longer shows the baseline/goals page (it's a free path now — either unmatched/redirected, or reused by nothing else in this feature, per implementation choice in tasks.md).
- Confirm `/account` (this feature's new page, reached via the profile dropdown) is a completely separate page from `/goals` and neither one's data or UI leaks into the other.

## Automated coverage (backend)

- New/extended `Backend/test/*.e2e-spec.ts` covering: display-name update, avatar upload (valid/invalid type, over-size), password change (correct/incorrect current password, no-password-yet case), Google link (already-linked-elsewhere conflict) and unlink (blocked when no password), preferences update, feedback send. Run via `npm run test:e2e` from `Backend/` (not part of CI, run locally per `CLAUDE.md`).
- Unit tests for the new `UsersService` methods (`Backend/src/modules/users/users.service.spec.ts`) covering ownership/validation logic with Prisma mocked. Run via `npm test` from `Backend/`.

No frontend automated test run — verify all five stories manually per above, plus `npm run build` and `npm run lint` from `Frontend/`.
