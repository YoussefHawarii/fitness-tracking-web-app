# Backend runs on Vercel Functions

In October 2026 Railway stopped the backend once its free credit ran out, and the owner chose not to pay for hosting. We moved the NestJS backend to Vercel's free tier instead. It runs as its own Vercel project with root directory `Backend/`, separate from the frontend's. Vercel detects NestJS from `src/main.ts` and runs the whole app as one Vercel Function on Fluid compute in `iad1`, next to the `us-east-1` database. No code restructuring or committed manifest was needed. Prisma's client is generated at install (`postinstall`) so a cached `node_modules` can never ship a stale client.

Serverless changes three things a long-lived server took for granted:

- **Database connections:** instances come and go with traffic, so the runtime uses the Supavisor transaction pooler (`pgbouncer=true`, small `connection_limit`) instead of session connections. Operator procedures such as `prisma db push` keep the session pooler URL from `.env.supabase`.
- **Rate limiting:** the 50-requests-per-5-minutes counters are held in each instance's memory, so the limit is per instance, not global. Making it global needs a shared store, which the free tier doesn't provide; at this app's traffic the difference is small.
- **Scheduled cleanup:** the once-a-minute expired-OTP cleanup only runs while an instance is alive. It was a backstop: expired codes are still rejected and deleted when someone tries to verify them.

Considered options:

- **Pay for Railway:** declined on cost.
- **Another always-on free host** (for example Render): its free instances sleep on idle, so cold starts are no better, and it adds a third provider.
- **Serving the API through the frontend project** (one origin, no CORS): couples the two deploys, and was rejected to keep the frontend and backend deploying independently as before.
