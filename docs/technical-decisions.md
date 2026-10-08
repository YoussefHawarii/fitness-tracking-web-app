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
- **Host:** Supabase Postgres (free tier), **database only**. Supabase Auth, Storage, Edge Functions and the Data API are not used; Prisma is the only data-access path. It became the production database in September 2026, when the previous host's free compute quota ran out and made the database unreachable. The previous database held only disposable test data, so the cutover started from an empty database built from the Prisma schema.
  - **Connection:** the backend runs as a Vercel Function in US-East (`iad1`), where instances come and go with traffic, so it connects through the Supavisor **transaction** pooler (port 6543, IPv4) as the dedicated `prisma` user, with `pgbouncer=true` (Prisma then skips prepared statements), `sslmode=require` and a small `connection_limit`. The session pooler (port 5432) suits a long-lived server, but each serverless instance would hold its own session connections and exhaust the free tier's small pool. `prisma db push` and other operator procedures still use the **session** pooler URL from the gitignored `Backend/.env.supabase`, never the runtime URL. The direct host is IPv6-only unless the IPv4 add-on is bought.
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
- **Deployment note:** the two Vercel projects (frontend and backend) each need to be configured to build/deploy only their own subfolder rather than the whole repo — a common first-time monorepo misconfiguration. Do a test deploy early to confirm this works before building the rest of the app on top of it.

### Hosting (all free tier, targeting $0/month total)
| Layer | Service |
|---|---|
| Frontend | Vercel |
| Backend | Vercel (separate project, NestJS as a Vercel Function — see ADR 0011) |
| Database | Supabase (Postgres only) |
