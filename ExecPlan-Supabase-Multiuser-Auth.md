# Supabase Multi-User Auth + Postgres Migration

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at the repository root and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, the tracker supports multiple users with Google login via Supabase. Each user sees only their own data. Food logging, fitness tracking, and assistant queries read and write to Postgres instead of local JSON files. The change is visible by logging in with Google, creating events, and confirming they are isolated per account. A feature flag allows the React login wiring to ship while remaining disabled until the backend is fully configured.

## Progress

- [x] (2026-02-06 19:00Z) Create this ExecPlan with scope, context, and acceptance.
- [x] (2026-02-06 19:20Z) Add Supabase auth wiring in the client behind a feature flag.
- [x] (2026-02-06 19:24Z) Add Supabase JWT verification middleware in the server with a feature flag to require auth.
- [x] (2026-02-06 19:32Z) Create Postgres schema with per-user tables and RLS policies.
- [ ] Implement Postgres data access alongside JSON helpers and add migration script.
- [ ] Switch runtime reads/writes to Postgres when enabled and validate end-to-end.
- [x] (2026-02-06 19:34Z) Update documentation and environment examples.

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Use Supabase for Google OAuth, Postgres, and Storage with JWT verification in Express.
  Rationale: It keeps auth, DB, and storage in one provider and reduces operational complexity.
  Date/Author: 2026-02-06 / Codex
- Decision: Gate auth UI and server auth enforcement behind environment flags so the wiring can ship before the backend is ready.
  Rationale: The user asked to stage login wiring without enabling it until Supabase is configured.
  Date/Author: 2026-02-06 / Codex
- Decision: Keep JSON tracking files as a fallback during migration, with an explicit switch to Postgres.
  Rationale: Enables a safe rollout and an easy rollback path during early testing.
  Date/Author: 2026-02-06 / Codex
- Decision: Gate client auth UI with `VITE_SUPABASE_ENABLED` and server enforcement with `SUPABASE_AUTH_REQUIRED`.
  Rationale: Allows the login wiring to ship while keeping auth disabled until Supabase is configured.
  Date/Author: 2026-02-06 / Codex

## Outcomes & Retrospective

Not started.

## Context and Orientation

The server is an Express app in `src/server.js` and currently reads/writes local JSON files through `src/trackingData.js`. The React UI is in `client/src/App.jsx`, and client API calls are in `client/src/api.js`. Food logging, fitness tracking, and assistant features are already implemented using these JSON files. There is no auth layer at present. The goal is to introduce Supabase authentication and migrate data to Postgres while preserving the existing behavior. A feature flag should allow login wiring to be present but inactive until Supabase setup is complete.

## Plan of Work

First, add Supabase client wiring in the React app and API layer, but keep it disabled by default with a `VITE_SUPABASE_ENABLED` flag. When disabled, the UI behaves exactly as it does today and does not show login UI or attach tokens to API calls. When enabled, show a simple login panel (Google sign-in, sign-out, current user email) and attach the Supabase access token to API requests via an `Authorization: Bearer <token>` header.

Next, add server-side JWT verification for Supabase tokens. Use a new middleware in `src/auth/supabaseAuth.js` (create this folder) that verifies the JWT signature using Supabase’s JWKS endpoint and extracts the user id from the `sub` claim. Gate enforcement with `SUPABASE_AUTH_REQUIRED`. When the flag is off, the middleware should become a no-op so the server accepts anonymous requests as it does today. When the flag is on, all API routes must require a valid token and set `req.user` to the authenticated user.

Then, create the Postgres schema and row-level security policies in Supabase. Define tables for `food_events`, `food_log`, `fitness_weeks`, `profiles`, and `rules`, each with a `user_id` column referencing `auth.users.id`. Store structured nutrient and item data in JSONB columns. Add RLS policies that allow a user to read/write only their own rows, and add indexes on `user_id` and frequently queried fields such as `date`.

After the schema is in place, implement a Postgres-backed data layer in `src/trackingDataPostgres.js`. Mirror the existing function names in `src/trackingData.js` so the server can switch between JSON and Postgres with a single feature flag such as `TRACKING_BACKEND=postgres|json`. Add a migration script under `scripts/migrate-json-to-postgres.js` that reads the existing `tracking-*.json` files, inserts them into Postgres for a specific user id, and prints a summary of records migrated.

Finally, flip the runtime reads/writes to Postgres when enabled, update documentation and environment variables, and validate the whole flow with a real Supabase project. Keep JSON as a fallback path with clear rollback instructions.

## Concrete Steps

Run commands from the repository root unless otherwise stated.

1. Add dependencies for Supabase and JWT verification. Install `@supabase/supabase-js` for the client and server, and `jose` for JWT validation. Update `package.json` and `package-lock.json` accordingly.

2. Add a new client module `client/src/supabaseClient.js` that creates a Supabase client using `import.meta.env.VITE_SUPABASE_URL` and `import.meta.env.VITE_SUPABASE_ANON_KEY`. Export helpers for `signInWithGoogle`, `signOut`, and `getSession`.

3. Update `client/src/api.js` to attach the Supabase access token on requests when `VITE_SUPABASE_ENABLED` is true. Keep existing behavior when false.

4. Update `client/src/App.jsx` to show a small auth panel when `VITE_SUPABASE_ENABLED` is true. The panel should show the current user email (if logged in), a “Sign in with Google” button, and a “Sign out” button. When disabled, the panel is hidden and no auth logic runs.

5. Add server middleware `src/auth/supabaseAuth.js` that verifies JWTs using Supabase JWKS. It should set `req.user = { id, email }` on success. Implement a factory to create the middleware with `SUPABASE_URL` so the JWKS URL can be constructed from env. If `SUPABASE_AUTH_REQUIRED` is false, the middleware should skip verification and set `req.user = null`.

6. Apply the middleware to all `/api` routes in `src/server.js` so that when auth is required, all existing endpoints are protected.

7. Create Postgres schema SQL in `supabase/schema.sql` with tables and RLS policies. Include indices for `(user_id, date)` on daily tables and `(user_id, logged_at)` on `food_events`. Keep a short inline comment describing each table in plain language.

8. Implement `src/trackingDataPostgres.js` mirroring the functions used in `src/server.js`. Use `@supabase/supabase-js` with the service role key on the server, and always filter by `user_id` from `req.user`. Ensure that writes always include `user_id`.

9. Add a backend switch in `src/trackingData.js` or `src/server.js` to select JSON or Postgres based on `TRACKING_BACKEND`. The default should remain JSON until migration is complete.

10. Add a migration script `scripts/migrate-json-to-postgres.js` that reads `tracking-food.json`, `tracking-activity.json`, `tracking-profile.json`, and `tracking-rules.json`, then inserts rows into Postgres for a provided `USER_ID` env. The script should be idempotent when re-run by checking for existing rows for that user and date before inserting.

11. Update `.env.example` and `README.md` with Supabase configuration variables and the new feature flags.

## Validation and Acceptance

Start the app with `npm run dev` and verify the following behaviors.

- With `VITE_SUPABASE_ENABLED=false` and `SUPABASE_AUTH_REQUIRED=false`, the app behaves exactly as it does today. The login UI is hidden and API calls do not include a token.
- With `VITE_SUPABASE_ENABLED=true` and a valid Supabase config, the login UI is visible and Google login succeeds. API calls include `Authorization: Bearer <token>`.
- With `SUPABASE_AUTH_REQUIRED=true`, unauthenticated API calls return HTTP 401 and authenticated calls succeed.
- With `TRACKING_BACKEND=postgres`, logging a meal and checking a fitness item create Postgres rows with the authenticated user id.
- Logging in as a second user shows no data from the first user.

If there are tests, run them and confirm they pass. If no tests exist, include a short manual check transcript in the Artifacts section.

## Idempotence and Recovery

The migration script should be safe to run multiple times without duplicating rows for the same user and date. If Postgres writes fail, set `TRACKING_BACKEND=json` to return to the local JSON storage path. If auth issues occur, set `SUPABASE_AUTH_REQUIRED=false` to restore anonymous access for debugging.

## Artifacts and Notes

None yet.

## Interfaces and Dependencies

Client dependencies: `@supabase/supabase-js` for OAuth and session handling. The client should expose a `getAccessToken()` helper that returns the current session token or null.

Server dependencies: `@supabase/supabase-js` for Postgres access using the service role key, and `jose` for JWT verification using the Supabase JWKS endpoint at `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`. The auth middleware should accept a `SUPABASE_URL` and derive the JWKS URL from it.

Supabase environment variables:

- Client: `VITE_SUPABASE_ENABLED`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Server: `SUPABASE_AUTH_REQUIRED`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Storage (optional): `SUPABASE_STORAGE_BUCKET=meal-photos`

Plan change note (2026-02-06 19:00Z): Initial ExecPlan created to describe Supabase multi-user auth, Postgres migration, and feature flags.
Plan change note (2026-02-06 19:34Z): Marked client auth wiring, server JWT middleware, schema SQL, and documentation updates as complete after implementation.
