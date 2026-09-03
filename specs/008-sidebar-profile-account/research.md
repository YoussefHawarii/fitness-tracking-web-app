# Research: Sidebar Profile Entry & Account/Settings Page

All unknowns from the Technical Context are resolved below.

## 1. Where to store the uploaded avatar photo

**Decision**: Store avatar photos in **Cloudinary**, using a signed, direct-from-browser upload: the backend generates a short-lived signed upload payload (`POST /profile/avatar/upload-signature` — timestamp, signature, API key, cloud name, a per-user folder path), the frontend uploads the file straight to Cloudinary's upload API with that payload (the image bytes never pass through our own backend), and on success the frontend sends Cloudinary's returned `secure_url` + `public_id` to the backend (`PATCH /profile/avatar`) to persist against the `User` row. Deleting an avatar calls Cloudinary's destroy API (via the backend, using the stored `public_id`) before clearing the row. Resizing/format optimization (cap to e.g. 512×512, `f_auto,q_auto`) is applied as an upload-time transformation on Cloudinary's side rather than client-side canvas work, since Cloudinary already does this as a first-class feature.

**Rationale**: User-specified — photos are to be stored via Cloudinary rather than the app's own database. A signed direct-upload flow is the standard, recommended Cloudinary integration pattern: it keeps the upload signature short-lived and scoped (the backend never hands out a long-lived secret to the browser), avoids proxying potentially multi-megabyte image bytes through the Railway backend (saving its bandwidth/memory), and offloads resizing/format work to Cloudinary instead of hand-rolling it in the browser. It also means avatar URLs are ordinary public HTTPS URLs — no authenticated `GET /profile/avatar` route or base64 data-URI plumbing is needed on the frontend; `<img src={avatarUrl}>` just works.

**Alternatives considered**:
- *Store raw bytes in Postgres (the original plan)*: superseded per explicit instruction to use Cloudinary instead.
- *Backend proxies the upload (browser → backend → Cloudinary)*: rejected — adds an unnecessary hop and makes the backend responsible for buffering large file uploads for no benefit over a signed direct upload, which is Cloudinary's documented preferred pattern.
- *Unsigned upload preset (no backend signature step at all)*: rejected — unsigned presets accept uploads from anyone who has the preset name (it's visible in frontend code), with no per-request tie to an authenticated user; a signed upload lets the backend control the destination folder/tags per user and keeps the operation gated behind `JwtAuthGuard`.

**New configuration**: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` added to `Backend/.env.example` and required env vars (mirrors how `USDA_API_KEY`/SMTP vars are already documented there); the `cloudinary` npm package is added as a new `Backend/` dependency to generate the signature and call destroy — both a config and dependency addition to note in tasks.md, not yet applied to the actual `.env.example`/`package.json` files at the planning stage.

## 2. Notification preferences — removed from scope

**Decision**: No Notifications section, no `NotificationPreference` table, no reminder-sending capability of any kind. Originally planned as a single `dailyLogReminderEmail` toggle (see history below), this was explicitly dropped by request — the app sends no push or email reminders today, and this feature does not add any. The Account/Settings page has six sections, not seven: Account, Preferences, Appearance, Support, About, Log out.

**Rationale**: User-specified — no need for a daily reminder email. Building a toggle for a notification that will never send would be dead UI with nothing real behind it; removing the whole section (rather than keeping an inert one) avoids exactly that.

**Superseded content (kept for history, not acted on)**: The original decision here specified a fixed boolean-column table (`dailyLogReminderEmail`, one row per user) rather than a generic key-value "notification type" table, reasoning that a generic table would suggest more types exist than the app can actually send today (no push infrastructure, one transactional-email use case to extend). None of this is being built.

## 3. Appearance (light/dark) theme mechanism

**Decision**: Introduce a `data-theme` attribute on `<html>` (`"light"` or `"dark"`), a `ThemeContext` that reads/writes it, and a **second value for every existing color token** in `Frontend/src/index.css`'s `@theme` block, scoped under `:root[data-theme="light"]` (dark stays the default, unscoped values — matching the app's current dark-only palette so no existing page needs to change). Persistence: save the explicit choice to the backend (`User.appearancePreference: 'LIGHT' | 'DARK' | null`) when signed in, and mirror it to `localStorage` for instant paint on the next load (before the profile fetch resolves) and as the offline/pre-auth fallback. When `appearancePreference` is `null` (never chosen), fall back to `window.matchMedia('(prefers-color-scheme: light)')`, defaulting to the existing dark theme if that API is unavailable.

**Rationale**: This directly follows the pattern `artifact-design` skill guidance describes for theme-aware pages (root-level token redefinition under a state selector, never per-component overrides) even though this is the app itself, not a published artifact — it's the correct general pattern for a Tailwind v4 `@theme`-token app: one set of semantic tokens, two value sets. Persisting to both the account (cross-device, per spec Story 2 Scenario 3) and `localStorage` (instant, pre-auth) satisfies FR-018 without a flash-of-wrong-theme on load.

**Alternatives considered**:
- *`localStorage`-only persistence*: rejected — spec Story 2 Scenario 3 explicitly expects the choice to follow the account across devices where possible, not just the one browser.
- *CSS `prefers-color-scheme` media query only, no manual override*: rejected — doesn't satisfy "user can explicitly switch and have it stick" (FR-017/018).
- *A UI component library theme system (e.g. next-themes equivalent)*: unnecessary dependency for a Tailwind-token app already using plain CSS custom properties.

**Light palette values**: Concrete `oklch()` values for the light variant are a design/implementation detail for the tasks phase (mirror lightness/chroma relationships from the existing dark set — e.g. near-white background, dark text, the same accent lime hue at adjusted lightness for contrast) — not re-derived here since it doesn't change the feature's architecture.

## 4. Units preference (kg/lb) — display-only conversion

**Decision**: Store `unitsPreference: 'KG' | 'LB'` on `User`. Conversion happens purely client-side at render time (kg × 2.20462, rounded for display) in the small set of places weight is already shown (`Profile.tsx`'s baseline/goal weight, `WeightTrend.tsx`). No backend calculation, storage, or API contract changes to any existing weight endpoint — they continue to accept/return kilograms exactly as today (per spec Assumption "does not migrate or change how weights are stored").

**Rationale**: Matches the spec's explicit assumption and keeps the blast radius small — existing weight-logging endpoints, DTOs, and stored `Decimal` values are entirely untouched; only presentation changes, gated by reading the same preference the Appearance/Account settings write.

**Alternatives considered**: Converting server-side per request — rejected, adds a needless per-endpoint dependency on user preference for a pure display concern that's cheaper and simpler to do once, client-side, at the point of rendering.

## 5. Linking/unlinking a Google account from Settings

**Decision**: Extract the existing token-verification logic in `AuthService.googleLogin()` (`this.googleClient.verifyIdToken(...)`) into a small reusable `verifyGoogleIdToken(idToken)` method on `AuthService`, and add two new authenticated `UsersService` methods that call it: `linkGoogleAccount(userId, idToken)` (rejects if that Google subject is already linked to a *different* user) and `unlinkGoogleAccount(userId)` (rejects with a clear error if `user.passwordHash` is null — the account has no other way to sign in, per FR-016/Story 3 Scenario 8). The frontend reuses the existing `GoogleSignInButton`'s underlying Google Identity Services flow (same `VITE_GOOGLE_CLIENT_ID`), but posts the resulting ID token to a new `/profile/google/link` route instead of `/auth/google`.

**Rationale**: Reuses the exact, already-tested Google ID token verification path instead of a second implementation; the "can't unlink your only sign-in method" guard is a direct, symmetric mirror of "can't change a password that doesn't exist" (Story 3 Scenario 6) — both prevent account lockout using data the `User` row already has (`passwordHash`, `googleSubjectId`).

**Alternatives considered**: A generic "linked providers" abstraction supporting arbitrary future providers — rejected per spec Assumptions ("Google only... adding new providers is out of scope"); building for providers that don't exist yet is premature.

## 6. Change/set password

**Decision**: Two endpoints on `users`: `PATCH /profile/password` (`ChangePasswordDto`: `currentPassword`, `newPassword` — both required) for accounts that already have a `passwordHash`, using the exact `bcrypt.compare`/`bcrypt.hash` pattern already used in `auth.service.ts` login; and `POST /profile/password` (`SetPasswordDto`: `newPassword` only) for accounts where `passwordHash` is currently null (Google-only), which simply sets it without requiring a "current" password that doesn't exist. `newPassword` reuses the exact validation already enforced at signup (`@MinLength(8)`).

**Rationale**: Splitting into two endpoints (rather than one endpoint with a sometimes-required field) keeps each request's validation unambiguous and matches the two genuinely different scenarios called out in Story 3 (Scenarios 4–6): "change" always requires proving you know the current password; "set" (no existing password) cannot require that. The frontend's Account page decides which one to call based on whether the profile response indicates a password is already set (a boolean `hasPassword` derived server-side, not the hash itself).

**Alternatives considered**: One endpoint with an optional `currentPassword`, required only when a password already exists — rejected as more error-prone (a bug could let a user "change" a password without proving the old one, if the "already has password" check is ever wrong) versus two endpoints whose access rule is baked into which one applies.

## 7. Feedback path (Support section)

**Decision**: An in-app form (subject + message, reusing existing `Input`/`FieldLabel`/`PrimaryButton`) posting to a new `POST /support/feedback` route, which uses the existing `MailService`/Nodemailer transporter to send the message to a new `SUPPORT_EMAIL` env var (falls back to the existing `SMTP_FROM` address if unset, so no new required config for local/dev setups that haven't added it yet).

**Rationale**: The existing SMTP setup already sends transactional email (OTP, welcome) — extending `MailService` with one more method is the smallest real ("full build," not `mailto:`-only) implementation, and reuses infrastructure and credentials that already exist rather than adding a form-service dependency (e.g. Formspree) or a full ticketing system, both disproportionate here.

**Alternatives considered**: `mailto:` link only — rejected as too thin given "full build" was the explicit chosen scope, though it remains an easy fallback documented here in case `SUPPORT_EMAIL`/SMTP isn't configured in a given environment (the send simply fails gracefully with a "couldn't send — try again" message, matching the existing `sendWelcomeEmail`'s best-effort-with-logging pattern).

## 8. Help Center, Terms of Service, Privacy Policy, App version

**Decision**: `Help Center`, `Terms of Service`, and `Privacy Policy` are simple external/anchor links (`<a href>`), each pointed at a placeholder URL/env var (`VITE_HELP_CENTER_URL`, `VITE_TERMS_URL`, `VITE_PRIVACY_URL`) with a sane in-repo fallback (e.g. a short static `/legal/terms` page bundled in the Frontend if no URL is configured) rather than authoring real legal copy, per spec Assumptions ("legal text itself is out of scope... links to wherever that content lives... or placeholders"). App version is read from the Frontend's own `package.json` version at build time (Vite exposes this via `import.meta.env` with a small `define` addition, or a generated constant) — no backend call needed since it's a build-time, not runtime, fact.

**Rationale**: Keeps this feature's real engineering effort on the parts with actual product behavior (theme, password, avatar, preferences) rather than content authoring, while still satisfying FR-023's "working links" requirement literally.

**Alternatives considered**: Fetching version from a backend `/health`-style endpoint — rejected as unnecessary indirection; the Frontend and Backend deploy somewhat independently (Vercel vs Railway) so the Frontend's own build version is the more meaningful "app version" a user-facing settings page should show anyway.

## 9. Removing the "profile" naming collision from the Goals page

**Decision**: Rename the existing baseline/weight-goal feature away from "profile" everywhere it appears as a name, not just the URL: frontend route `/profile` → `/goals`, frontend page component `Frontend/src/pages/Profile.tsx` → `Frontend/src/pages/Goals.tsx` (exported function `Profile` → `Goals`), `AppShell.tsx`'s nav entry updated to `{ to: '/goals', ... }`, and the backend API path `GET/PATCH /profile` (in `UsersController`) → `GET/PATCH /goals`. The frontend service functions in `Frontend/src/services/userService.ts` (`getProfile`/`updateProfile`) are renamed to `getGoals`/`updateGoals` calling the new `/goals` path, for the same reason — no lingering "profile" name anywhere in this feature's sibling code.

**Rationale**: User-specified, to fully eliminate any ambiguity between the pre-existing "Goals" page (baseline/weight-goal tracking, unrelated to this feature) and this feature's new Account/Profile concept — going beyond the originally-planned "use sibling paths" approach (`/profile` vs `/profile/account`) to actually remove the word "profile" from the older feature's name entirely, since the two were never conceptually related to begin with (one is fitness goals, the other is account identity/settings) and only shared a name by historical accident. This is a mechanical rename with no behavior change — same component logic, same data, same DTOs (`OnboardingDto`, `UpdateProfileDto` — left as-is internally; renaming internal DTO class names is optional polish, not required for the collision to be resolved) — satisfying the FR-025 carve-out.

**Scope note**: `OnboardingDto`/`UpdateProfileDto`, `Baseline` type, and the `UsersService.getProfile()`/`updateProfile()` method names are internal implementation details not exposed as a route path or user-facing label — renaming them is optional cleanup, not required to resolve the naming collision, and is left out of this feature's required task list to keep the change focused on the actually-colliding surface (URLs and nav labels a user or another developer integrating against the API would see).

**Alternatives considered**: Keep `/profile` for Goals and rely solely on the new feature's routes being namespaced under `/profile/account` etc. (the original plan) — superseded per explicit instruction to make Goals "individual, not related to profile" rather than just non-colliding.
