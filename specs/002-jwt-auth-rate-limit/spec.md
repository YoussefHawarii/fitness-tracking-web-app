# Feature Specification: JWT Auth & Rate Limiting

**Feature Branch**: `002-jwt-auth-rate-limit`

**Created**: 2026-08-28

**Status**: Draft

**Input**: User description: "i want to make the backend has an access token and refresh token , access token to be valid for 30 min and refresh token to be valid for a week, make sure to use both JWT/JWK and make it generate with every request user send, i also want you to add rate limiter to the project to have a limit of a 50 req per 5 min from the same user."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Seamless session continuity (Priority: P1)

As a signed-in user, I want the app to keep working smoothly during my session without forcing me to log in again every few minutes, so my access is renewed automatically as long as I remain active within a reasonable window.

**Why this priority**: This is the core of the feature — without automatic renewal, a 30-minute access window would constantly interrupt users. This is the foundation the rest of the feature builds on.

**Independent Test**: Log in, wait past the 30-minute access window, then perform an action in the app. The action succeeds without the user having to re-enter credentials, because the session was renewed behind the scenes.

**Acceptance Scenarios**:

1. **Given** a user logged in less than 30 minutes ago, **When** they perform an action, **Then** the action succeeds using their current access credential.
2. **Given** a user's 30-minute access window has expired but they logged in within the last 7 days, **When** they perform an action, **Then** the system silently renews their access and the action succeeds without prompting for a password.
3. **Given** a user has not used the app in over 7 days, **When** they try to perform an action, **Then** the system requires them to log in again.

---

### User Story 2 - Forced re-authentication after prolonged inactivity (Priority: P2)

As a security-conscious product owner, I want a user's ability to silently renew their session to expire after 7 days of inactivity, so that abandoned or stolen sessions can't be used indefinitely.

**Why this priority**: Protects user accounts and data; depends on User Story 1 existing first, but is essential for the feature to be considered secure rather than just convenient.

**Independent Test**: Simulate a session older than 7 days and confirm the user is redirected to login and cannot perform any authenticated action.

**Acceptance Scenarios**:

1. **Given** a user's session is older than 7 days, **When** they attempt any action requiring authentication, **Then** they are denied and directed to log in again.
2. **Given** a user explicitly logs out, **When** they try to use their old session afterward, **Then** the system rejects it, even if it was still within the 7-day window.

---

### User Story 3 - Protection from excessive requests (Priority: P1)

As a platform operator, I want to cap how many requests any single user can make in a short time window, so the system stays available and responsive for everyone and is protected from accidental or intentional abuse.

**Why this priority**: Without this, a single misbehaving client (buggy retry loop, script, or malicious actor) could degrade service for all users. Equal priority to seamless sessions because both are needed for a trustworthy, production-ready backend.

**Independent Test**: Send 51 requests as the same user within 5 minutes and confirm the 51st is rejected with a clear "too many requests" response, while other users are unaffected.

**Acceptance Scenarios**:

1. **Given** a user has made 50 requests within the last 5 minutes, **When** they send a 51st request, **Then** the system rejects it and informs them they've hit the limit.
2. **Given** a user was rate-limited, **When** the 5-minute window rolls forward and their request count drops back under 50, **Then** their next request succeeds normally, with no manual action needed.
3. **Given** two different users are each making requests, **When** one user hits their limit, **Then** the other user's requests are unaffected.

---

### Edge Cases

- What happens if a user's session-renewal credential is presented after it has already expired or already been used to renew once? The system must deny it and require a fresh login.
- What happens if a user is logged in on multiple devices — does hitting the request limit on one device affect the others? (See Assumptions — limit applies per user, across all their devices/sessions combined.)
- What happens to in-flight requests the moment the 30-minute access window lapses mid-request? The request should complete or fail based on the state at the time it was accepted, not be retroactively invalidated.
- What happens when an unauthenticated (not-yet-logged-in) client sends a burst of requests, e.g. to a login endpoint? It should still be rate-limited to prevent abuse, tracked by connection origin rather than user identity.
- How does the system respond if the renewal credential itself is malformed, tampered with, or from an untrusted source? It must be rejected outright and treated the same as an expired credential.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST issue a short-lived access credential valid for exactly 30 minutes upon successful login.
- **FR-002**: System MUST issue a longer-lived renewal credential valid for exactly 7 days upon successful login.
- **FR-003**: System MUST allow a user to silently obtain a new 30-minute access credential using a still-valid renewal credential, without re-entering their password.
- **FR-004**: System MUST reject any action that relies on an access credential which has expired, is malformed, or was not issued by the system.
- **FR-005**: System MUST reject any renewal attempt that relies on a renewal credential which has expired, was already used, is malformed, or was not issued by the system.
- **FR-006**: System MUST invalidate a user's renewal credential immediately when the user logs out, so it cannot be used afterward even if still within its 7-day window.
- **FR-007**: System MUST limit each individual user to 50 requests within any rolling 5-minute window.
- **FR-008**: System MUST clearly inform a user when they have exceeded their request limit, including when they will be able to send requests again.
- **FR-009**: System MUST automatically resume allowing a user's requests once their rolling 5-minute window no longer shows 50+ requests, with no manual unblocking required.
- **FR-010**: System MUST apply the request limit independently per user, so one user hitting their limit does not affect any other user's ability to make requests.
- **FR-011**: System MUST apply a request limit to not-yet-authenticated traffic as well, tracked by the connection making the requests, using the same 50-per-5-minutes threshold. *(Assumption — see below)*
- **FR-012**: Each access credential MUST always expire exactly 30 minutes after it was issued, regardless of how much activity occurs in between; the system MUST NOT extend an existing access credential's expiry due to activity. A new access credential is only (re)issued at login or via a renewal using a still-valid renewal credential (per FR-003).

### Key Entities

- **Access Credential**: A short-lived (30-minute) proof of identity a user's client presents with each action; expires automatically and cannot be extended on its own.
- **Renewal Credential**: A longer-lived (7-day) proof of identity used solely to obtain a new Access Credential without re-entering a password; becomes invalid after logout, after 7 days, or after a single use (per Assumptions).
- **Request Count Window**: A rolling 5-minute tally of how many requests a given user (or unauthenticated origin) has made, used to enforce the 50-request cap.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user who opens the app at least once within any 7-day period never has to manually log in again during that period.
- **SC-002**: No user is ever interrupted mid-session by a credential expiring, as long as they remain active within the 7-day renewal window.
- **SC-003**: 100% of actions using an access credential older than 30 minutes (past its last renewal) are rejected until renewed.
- **SC-004**: 100% of actions using a renewal credential older than 7 days, already used once, or presented after logout are rejected, requiring fresh login.
- **SC-005**: A user sending more than 50 requests in any 5-minute window is blocked from further requests until the window resets, with zero impact on other users' request activity in the same window.
- **SC-006**: Users who hit the request limit receive a clear, immediate explanation and are able to resume normal use within 5 minutes without contacting support.

## Assumptions

- The renewal credential is single-use per renewal: presenting it successfully issues a new access credential (and, per common security practice, a new renewal credential), and the original renewal credential cannot be reused afterward.
- The 50-requests-per-5-minutes limit applies per logged-in user across all of that user's active sessions/devices combined, not separately per device.
- Unauthenticated traffic (e.g., login attempts) is rate-limited by connection origin using the same 50-per-5-minutes threshold, since no user identity exists yet to key the limit on.
- This feature governs how session credentials are issued, renewed, expired, and rate-limited; it does not change how a user's initial username/password (or other) login is performed.
- "JWT/JWK" in the input is understood as a stated technical constraint on how credentials are structured and verified, not a new user-facing capability — the user-facing behavior is fully described by FR-001 through FR-006 regardless of the underlying token format.
