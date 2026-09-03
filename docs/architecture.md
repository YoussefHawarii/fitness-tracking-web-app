# High-Level Architecture
## Calorie & Weight Tracking Web App

### 1. System Overview
A three-tier web app: browser client (React/Angular SPA) → backend API (Node.js/NestJS) → PostgreSQL database, with two external food-data APIs and one browser-native (not backend-routed) speech API.

```
┌─────────────────────────────────────────────────────────┐
│                     CLIENT (Browser SPA)                 │
│  Auth UI · Dashboard · Manual Entry Forms                │
│  Camera Module (barcode scan)  │  Mic Module (voice)     │
└──────────────┬──────────────────────────┬────────────────┘
               │ REST/HTTPS               │ (client-side only,
               │                          │  no backend round-trip
               ▼                          │  for the transcription
┌─────────────────────────────┐           │  step itself)
│      BACKEND API (NestJS)   │           ▼
│  ┌────────────┐ ┌─────────┐ │   Web Speech API
│  │ Auth module│ │User/     │ │   (browser-native, free)
│  │ (JWT)      │ │Baseline  │ │
│  └────────────┘ │module    │ │
│  ┌────────────┐ └─────────┘ │
│  │Food Lookup │ ┌─────────┐ │
│  │& Log module│ │Weight/   │ │
│  └─────┬──────┘ │Prediction│ │
│        │        │module    │ │
│        │        └─────────┘ │
└────────┼─────────────┬──────┘
         │              │
         ▼              ▼
┌──────────────┐  ┌──────────────────┐
│ Open Food    │  │ USDA FoodData    │
│ Facts API    │  │ Central API      │
│ (barcode →   │  │ (generic food    │
│  packaged    │  │  name → nutrient │
│  product     │  │  data)           │
│  data)       │  └──────────────────┘
└──────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│     PostgreSQL (via Prisma ORM)     │
│  Users · UserBaseline · FoodLogs ·  │
│  LocalFoodItems · WeighIns          │
└─────────────────────────────────────┘
```

### 2. Client Layer (React or Angular SPA)
- **Auth screens:** signup (collects onboarding data per requirements §4.1), login. Two providers only: system (email/password) and Google OAuth — no other third-party providers, to keep auth surface simple.
- **Camera module:** `getUserMedia` + client-side barcode decode library (html5-qrcode or zxing-js). Decoded barcode sent to backend; no image data itself needs to leave the browser.
- **Mic module:** Web Speech API runs entirely client-side. Transcription happens in-browser; only the confirmed/edited text is sent to the backend — the audio itself never needs to leave the client, which also sidesteps any audio-upload/storage concern.
- **Manual entry forms:** used both as a direct feature and as the fallback path when barcode/voice lookups miss.
- **Dashboard:** daily calorie total, weight trend chart (predicted vs. actual, per business logic §3/§8), meal log grouped by category.
- BMR/TDEE/prediction math is **not** duplicated here — client only displays values computed by the backend, so there's a single source of truth for the formulas (avoids the two layers drifting out of sync if the formula changes later).

### 3. Backend Layer (Node.js + NestJS)
- **Auth module:** JWT-based session handling, password hashing. Supports two providers — system (email/password) and Google OAuth. **Account linking rule:** if a user signs up via Google using an email that already exists as a system account (or vice versa), both are merged into a single user record rather than creating a duplicate — matched by email address.
  - **Security caveat worth flagging:** linking accounts purely by matching email address is safe when the incoming email is *verified* — Google OAuth verifies email ownership itself, so a Google sign-in is trustworthy for this. But if the system signup path allows an unverified email, someone could register a system account with an email they don't actually own, then have it silently merged when the real owner later signs in with Google — effectively granting the squatter access to the real owner's merged account. Mitigation: require email verification on system signup before it's eligible for linking, or only perform the merge (rather than blocking/flagging it) once both sides are verified.
- **User/Baseline module:** stores onboarding data; computes BMR/TDEE per business logic §1; recalculates on profile updates.
- **Food Lookup & Log module:** implements the routing logic from business logic §5 —
  1. Barcode → Open Food Facts.
  2. Voice-confirmed text → USDA FoodData Central.
  3. Either miss → local per-user fallback table.
  Also performs the gram-based calorie calculation (business logic §4) before persisting a log entry.
- **Weight/Prediction module:** implements the daily-balance and trend-prediction math (business logic §2–3), and the predicted-vs-actual comparison (business logic §8).
- All day-boundary calculations (business logic §7) happen here, using each user's stored timezone — never computed client-side, to avoid clock-skew inconsistencies between client and server.

### 4. Data Layer (PostgreSQL + Prisma)
Core tables (illustrative, not a full schema):
- `users` — auth credentials, timezone, auth provider(s) linked (system and/or Google, per §3 account-linking rule), email verification status.
- `user_baselines` — age, sex, height, current/goal weight, activity level, computed BMR/TDEE.
- `food_logs` — user_id, food_item reference, grams, computed calories, meal category, timestamp.
- `local_food_items` — user-scoped manual entries (name, calories/100g, macros), type-validated on insert.
- `weigh_ins` — user_id, logged weight, date.
- `exercise_logs` — user_id, calories burned, date (optional per entry, per business logic §2).
Foreign keys tie all logs back to `users`, enforcing the data-integrity requirement (requirements §5).

### 5. External Integrations
| Service | Role | Notes |
|---|---|---|
| Open Food Facts API | Barcode → packaged product nutrient data | Free, no key; must check response body status field, not just HTTP status (business logic §5) |
| USDA FoodData Central | Food name → generic nutrient data | Free, requires a free API key |
| Web Speech API | Voice → text | Browser-native, client-side only, not a backend integration |

### 6. Deployment Topology (targeting $0/month)
- **Frontend:** Netlify free tier (static SPA hosting).
- **Backend:** Render free tier. Known trade-off already flagged in requirements §5: free-tier instances sleep when idle, causing a slow first request after inactivity.
- **Database:** Neon (free tier Postgres).
  - Neon's free tier includes a built-in PgBouncer connection pooler <cite index="1-1">accepting up to 10,000 client connections, well above what Prisma's default pool needs</cite> — the connection-cap concern that applies to some other providers isn't a real issue here.
  - **New consideration to flag instead:** Neon's compute <cite index="1-1">scales to zero after 5 minutes of inactivity</cite>, same idle-sleep behavior as Render's free backend tier. That means a cold request can hit *both* layers waking up from sleep at once (backend spinning up + database spinning up), so the "slow first request after inactivity" trade-off already noted for Render is compounded, not just present once. Worth testing what that combined cold-start delay actually feels like before assuming it's negligible.

### 7. Key Architectural Decisions Carried From Prior Docs
- Business logic (formulas, routing rules, day-boundary math) lives entirely in the backend — the client is a thin presentation layer, not a second implementation of the rules.
- No image data or audio ever needs backend storage — barcode decode and speech transcription both happen client-side, keeping the backend simpler and avoiding any file-storage cost.
- Local food items are private per user (not shared), removing the need for any moderation/review subsystem.
