# Feature Specification: Email OTP Signup Verification

**Feature Branch**: `003-email-otp-verification`

**Created**: 2026-08-30

**Status**: Draft

**Input**: User description: "okay great, now in sign up page i would like the user to enter his username, Email, password then after he entered this data i want the sign up bottom to be send verification email instead, then user should rerouted to another page to enter the OTP he received via his email, i want you to user nodemailer library for OTP and i want the OTP to be 6 Digits, also after the user enter the OTP he should go to the home page, and after that he should receive another new email as a thanks email to joining the app." Follow-up: "i want to update to make sure that the TTL of the OTP is only 5 mins and after that it got deleted from DB"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign up and verify email with a one-time code (Priority: P1)

A new visitor fills in a username, email address, and password on the sign-up page and submits the form. Instead of being logged in immediately, they are told a verification code was sent to their email and are taken to a verification page. They retrieve the 6-digit code from their inbox, enter it, and are then taken straight to the home page as a signed-in, verified user.

**Why this priority**: This is the entire feature — without it, there is no email-verified signup flow. It also protects the app from fake or mistyped email addresses at account creation.

**Independent Test**: Can be fully tested by submitting the sign-up form with a real inbox, retrieving the 6-digit code from the received email, entering it on the verification page, and confirming the user lands on the home page as an authenticated, verified account.

**Acceptance Scenarios**:

1. **Given** a visitor is on the sign-up page, **When** they submit a valid username, email, and password, **Then** no session is created yet, a 6-digit code is emailed to that address, and they are redirected to a verification page referencing that email.
2. **Given** a user is on the verification page with a valid, unexpired code in their inbox, **When** they enter the correct 6-digit code, **Then** their account is marked verified, they are signed in, and they are redirected to the home page.
3. **Given** a user is on the verification page, **When** they enter an incorrect code, **Then** the system rejects it, explains the code was wrong, and lets them try again without leaving the page.

---

### User Story 2 - Request a new code when the original is lost or expired (Priority: P2)

A user who didn't receive the email, let it expire, or mistyped it too many times can ask for a fresh 6-digit code without restarting the whole sign-up process.

**Why this priority**: Email delivery is unreliable and codes must expire for security, so without a resend path some users would be permanently stuck unable to complete signup.

**Independent Test**: Can be fully tested by letting a code expire (or exhausting incorrect attempts), requesting a new code from the verification page, and confirming a new email arrives and the previous code no longer works.

**Acceptance Scenarios**:

1. **Given** a user's verification code has expired, **When** they request a new code, **Then** a new 6-digit code is emailed and the expired code is no longer accepted.
2. **Given** a user has just requested a new code, **When** they immediately request another one, **Then** the system prevents rapid repeated requests until a short cooldown has passed.

---

### User Story 3 - Receive a welcome email after verification (Priority: P3)

Once a user successfully verifies their email and lands on the home page, they receive a separate thank-you/welcome email confirming they've joined the app.

**Why this priority**: This is a nice-to-have confirmation and engagement touchpoint; it doesn't gate access to the app, so it can ship after the core verification flow works.

**Independent Test**: Can be fully tested by completing verification and confirming a distinct welcome email (not the OTP email) arrives in the user's inbox shortly after.

**Acceptance Scenarios**:

1. **Given** a user has just successfully entered their verification code, **When** they land on the home page, **Then** a welcome/thank-you email is sent to their address separately from the earlier OTP email.
2. **Given** the welcome email fails to send for any reason, **When** this happens, **Then** the user's access to the home page is unaffected.

---

### Edge Cases

- What happens when a user enters the wrong code five times in a row? The current code is invalidated and they must request a new one.
- What happens when a user lets the code expire before entering it? The verification page tells them it expired and offers to resend.
- What happens when someone tries to sign up again with an email that already has a pending (unverified) signup? The system re-sends a fresh code for that pending account rather than creating a duplicate.
- What happens when someone tries to sign up with a username that's already taken? The sign-up form is rejected with a clear message before any email is sent.
- What happens when the verification email cannot be delivered (bad address, mail provider outage)? The user sees an error on the sign-up page and can retry sending.
- What happens if a user closes the browser after requesting a code and comes back later? They can return to the verification page (or start sign-in) and request a new code if the old one is gone or expired.
- What happens if a user who already has a verified account tries to sign up again with the same email? The system tells them the email is already registered and directs them to log in instead.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST let a new user provide a username, email address, and password on the sign-up page.
- **FR-002**: System MUST reject sign-up if the username is already in use by another account.
- **FR-003**: System MUST reject sign-up if the email already belongs to a fully verified account, and direct the user to log in instead.
- **FR-004**: On sign-up submission, system MUST NOT create an authenticated session immediately; instead it MUST create/update a pending, unverified account and send a one-time verification code to the provided email address.
- **FR-005**: The verification code MUST consist of exactly 6 digits.
- **FR-006**: System MUST redirect the user to a dedicated verification page immediately after a verification code is requested.
- **FR-007**: System MUST let the user enter the verification code on the verification page and submit it for checking.
- **FR-008**: System MUST reject incorrect codes with a clear message and allow the user to try again.
- **FR-009**: Verification codes MUST expire exactly 5 minutes after being sent, after which they are no longer accepted even if correct.
- **FR-010**: System MUST let the user request a new verification code from the verification page, subject to a short cooldown between requests.
- **FR-011**: When a correct, unexpired code is entered, system MUST mark the account as verified and establish an authenticated session for the user.
- **FR-012**: Upon successful verification, system MUST redirect the user into the existing new-account setup flow (age/sex/height/weight/goal/activity level, per `specs/001-calorie-weight-tracking`) so a calorie baseline exists before they reach the home page — **corrected 2026-08-30**: an earlier version of this requirement sent verified users straight to the home page, which skipped that setup entirely and left new accounts without a baseline; the setup flow itself already redirects to the home page on its own completion, so the end state (home page, eventually) is unchanged.
- **FR-013**: Immediately after successful verification, system MUST send a separate welcome/thank-you email to the user's registered address, distinct from the verification code email.
- **FR-014**: System MUST prevent sign-in or app access for accounts that have not completed email verification.
- **FR-015**: System MUST invalidate a verification code after too many incorrect attempts against it, requiring the user to request a new one.
- **FR-016**: System MUST permanently delete an expired verification code from storage rather than merely marking it invalid, so no stale codes remain queryable once their 5-minute window has passed.

### Key Entities

- **Account**: A user's identity in the system — username, email address, password (stored securely), and a verification status distinguishing "pending" from "verified" accounts.
- **Verification Code**: A short-lived 6-digit code tied to one account's pending signup, with a 5-minute expiration time and a count of incorrect attempts made against it; the record itself is removed once expired rather than kept around in an expired state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users receive their verification code email within 1 minute of submitting the sign-up form in at least 95% of cases.
- **SC-002**: A user can go from submitting the sign-up form to landing on the home page (including retrieving and entering the code) in under 3 minutes.
- **SC-003**: No user reaches the home page or any in-app feature without having entered a correct verification code.
- **SC-004**: At least 95% of newly verified users receive their welcome email within 1 minute of completing verification.
- **SC-005**: Users who mistype or lose their code can recover and complete signup without contacting support, in at least 95% of cases.

## Assumptions

- Verification codes expire 5 minutes after being sent, and expired codes are deleted from storage rather than left in place.
- A user may request a replacement code after a 60-second cooldown from the previous request. Since the old code is deleted once expired, a resend after expiry always generates a brand-new code rather than reusing or reviving the old one.
- Deletion of expired codes may happen immediately at expiry time or via a periodic cleanup sweep — either satisfies the requirement as long as an expired code can no longer be found or matched once its 5-minute window has passed.
- After 5 incorrect code attempts, the active code is invalidated and a new one must be requested.
- Usernames must be unique across accounts; format/length rules follow standard conventions (e.g., 3–30 characters) since none were specified.
- Verification codes are sent via Nodemailer, per explicit stakeholder direction, using the app's existing backend email-sending setup.
- The welcome/thank-you email is best-effort and non-blocking — a delivery failure does not prevent or roll back the user's access to the home page.
- This flow applies to email/password sign-up only; the existing Google sign-in path is unaffected and continues to grant immediate access without an OTP step, since Google already verifies the account owner's email.
- "Home page" refers to the app's existing authenticated landing page (currently reached after login). A newly verified account is routed there via the existing account-setup flow (FR-012), not directly — that flow's own completion redirect is what actually lands the user on the home page.
