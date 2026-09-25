# Technical Decisions
## Calorie & Weight Tracking Web App

### Frontend
- **Framework:** React.
- **State management:** lightweight — React Context, or Zustand if more structure is needed. Redux explicitly ruled out — too much ceremony for this app's scope; using it here would be a scope mismatch, not a strength, if reviewed by an interviewer.
- **Styling:** Tailwind CSS.
- **Barcode scanning:** zxing-js (`@zxing/browser`). Chosen over html5-qrcode for more manual control over the camera stream/decode loop — deliberately more implementation work than the simpler alternative, taken on for the learning/resume value of demonstrating direct camera-hardware integration. Budget extra time for this versus a plug-and-play scanning component.
- **Voice input:** Web Speech API (browser-native, no library needed).

### Backend
- **Framework:** NestJS (Node.js).
- **API style:** REST. GraphQL considered (given existing Apollo/GraphQL experience) but ruled out — this app's data is flat/non-nested, which is exactly the case REST suits better; GraphQL's main advantage (avoiding over-fetching nested data) doesn't apply here.
- **Auth:** JWT-based sessions. Two providers: system (email/password) and Google OAuth, with email-based account linking (see architecture.md §3 for the verified-email caveat on linking).
- **ORM:** Prisma.

### Database
- **Engine:** PostgreSQL.
- **Host:** Supabase Postgres (free tier), **database only**. Supabase Auth, Storage, Edge Functions and the Data API are not used; Prisma is the only data-access path. It replaced Neon in September 2026, after Neon's free compute quota ran out and made the database unreachable. Neon held only disposable test data, so the cutover started from an empty database built from the Prisma schema.
  - **Connection:** the Railway backend is a long-lived server in US-East, so it connects through the Supavisor **session** pooler (port 5432, IPv4, supports prepared statements) as a dedicated `prisma` user, with `sslmode=require` and an explicit `connection_limit`. No `DIRECT_URL` is needed. The transaction pooler (port 6543, needs `pgbouncer=true`) is meant for serverless, and the direct host is IPv6-only unless the IPv4 add-on is bought. `prisma db push` runs over the same session connection.
  - **Data API:** turned off, and `anon`/`authenticated` hold no privileges on application tables, so the Supabase publishable key cannot read them.
  - **Free-tier trade-offs:** 500 MB per project, and a project pauses after 7 days of low activity. There is no point-in-time restore, so destructive schema steps take an explicit `pg_dump` first.
- **Local development and e2e:** the Docker Postgres in the repo-root `docker-compose.yml` (Postgres 17, matching production). Local `.env` and tests must never point at the deployed database.

### Testing
- **Framework:** Jest.
- **Scope for v1:** unit tests on the business-logic module specifically — BMR/TDEE calculation, calorie-balance math, weight-prediction formula (the pure-function code where a silent error, like the double-counting risk already caught and fixed in business-logic.md §2, would actually matter). Broader integration/E2E testing explicitly out of scope for v1.

### CI/CD
- **Tool:** GitHub Actions (free tier — unlimited minutes on public repos, 2,000 min/month on private).
- **Scope:** run the Jest test suite automatically on every pull request.

### Repository Structure
- **Monorepo** with `/client` and `/server` folders.
- **Deployment note:** Vercel and Railway both need to be configured to build/deploy only their respective subfolder rather than the whole repo — a common first-time monorepo misconfiguration. Do a test deploy early to confirm this works before building the rest of the app on top of it.

### Hosting (all free tier, targeting $0/month total)
| Layer | Service |
|---|---|
| Frontend | Vercel |
| Backend | Railway |
| Database | Supabase (Postgres only) |
