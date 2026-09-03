# API Contract: Exercise Logs

Base path: existing `calorie-balance` module (unauthenticated requests rejected by the existing `JwtAuthGuard`, same as all endpoints in this controller). `userId` is always derived from the authenticated JWT via `@CurrentUser()`, never accepted from the request body/params.

## POST /exercise-logs

Create a new exercise session (replaces the current shape — `caloriesBurned` is no longer client-supplied).

**Request body**:

```json
{
  "sportType": "RUNNING",
  "customSportName": null,
  "durationMinutes": 30,
  "date": "2026-08-30"
}
```

- `sportType`: one of `FOOTBALL | SWIMMING | PADEL | BASKETBALL | GYM_WEIGHTS | RUNNING | TENNIS | OTHER` (required)
- `customSportName`: string, required and non-empty only when `sportType = "OTHER"`; omitted/ignored otherwise
- `durationMinutes`: integer, 1–1440 (required)
- `date`: `YYYY-MM-DD`, user's local date (required) — same convention as the existing endpoint

**Response `201`**:

```json
{
  "id": "uuid",
  "userId": "uuid",
  "sportType": "RUNNING",
  "customSportName": null,
  "durationMinutes": 30,
  "caloriesBurned": 245,
  "loggedForDate": "2026-08-30"
}
```

**Errors**:
- `400` — validation failure (bad `sportType`, missing `customSportName` for `OTHER`, `durationMinutes` out of range, invalid `date`)
- `400` — no baseline on file for this user (calorie calculation not possible) — response body includes a message directing the user to complete onboarding first
- `401` — unauthenticated

---

## PATCH /exercise-logs/:id

Edit an existing session's sport and/or duration; `caloriesBurned` is recalculated server-side.

**Request body** (all fields optional, at least one required):

```json
{
  "sportType": "SWIMMING",
  "customSportName": null,
  "durationMinutes": 45
}
```

**Response `200`**: same shape as the create response, reflecting the updated values.

**Errors**:
- `400` — same validation rules as create, applied to whichever fields are present
- `404` — no entry with this `id` owned by the requesting user (also returned, not `403`, for an entry that belongs to someone else — see `research.md` "Decision: Ownership enforcement")
- `401` — unauthenticated

---

## DELETE /exercise-logs/:id

Permanently delete an existing session.

**Response `204`**: empty body.

**Errors**:
- `404` — no entry with this `id` owned by the requesting user
- `401` — unauthenticated

---

## GET /exercise-logs?date=YYYY-MM-DD

List the requesting user's exercise sessions for the given local date, most recent first. New endpoint backing the Exercise page's list (FR-009).

**Response `200`**:

```json
[
  {
    "id": "uuid",
    "sportType": "RUNNING",
    "customSportName": null,
    "durationMinutes": 30,
    "caloriesBurned": 245,
    "loggedForDate": "2026-08-30"
  }
]
```

**Errors**:
- `400` — missing/invalid `date` query param
- `401` — unauthenticated

---

## GET /balance?date=YYYY-MM-DD (existing, unchanged contract)

No change to this existing endpoint's request/response shape — `caloriesBurnedExercise` in its response continues to be the sum of the date's `ExerciseLogEntry.caloriesBurned` values, now sourced from sport+duration-calculated entries instead of raw client-supplied ones. This is what keeps the Dashboard's "Exercise" tile and the Exercise page's total in sync (SC-004).

## GET /sports (new, static reference endpoint)

Returns the fixed sport catalog so the Frontend doesn't hardcode the list independently of the backend's MET table (avoids drift between the two).

**Response `200`**:

```json
[
  { "sportType": "RUNNING", "label": "Running" },
  { "sportType": "FOOTBALL", "label": "Football" },
  { "sportType": "SWIMMING", "label": "Swimming" },
  { "sportType": "PADEL", "label": "Padel" },
  { "sportType": "BASKETBALL", "label": "Basketball" },
  { "sportType": "GYM_WEIGHTS", "label": "Gym / Weight Training" },
  { "sportType": "TENNIS", "label": "Tennis" },
  { "sportType": "OTHER", "label": "Other" }
]
```

No auth required for this endpoint (static, non-user data) — but it's simplest to keep it behind the same `JwtAuthGuard` as the rest of the controller for consistency; no functional reason a logged-out user would need it.
