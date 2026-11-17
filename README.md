# MOM — campus food-stall pre-ordering

Students around VSSUT pick a food stall, browse its menu, pay by **UPI** or **cash**, get a
**token + QR code**, and collect their food at the counter. Stall owners run orders, menus and a
pickup scanner from their console. The MOM team runs everything from the super-admin console.

- 📄 **Product & engineering spec:** [spec.md](spec.md)
- ✅ **Backlog:** [30 issues in 6 milestones](https://github.com/subhankar2004/MOM/milestones), built one by one
- 🗄️ **Old prototype** (Supabase + Expo): git tag [`prototype-v0`](https://github.com/subhankar2004/MOM/tree/prototype-v0)

## Repository layout

```
MOM/
├── apps/
│   ├── api/        Fastify + TypeScript REST/SSE API              (issue #5)
│   └── web/        Next.js web app: student · vendor · admin      (issue #6)
├── packages/
│   └── shared/     Code shared by api + web: money/fee maths, types (issue #4)
├── spec.md         What we are building and how
└── CONTRIBUTING.md How we work: issue → branch → PR → merge
```

`infra/` (AWS CDK) is added in issue #28.

## Getting started

Needs **Node.js 24+** (`node -v`) and **Docker Desktop** (running).

```bash
npm install          # installs every workspace
npm run setup        # creates apps/api/.env and apps/web/.env.local from the examples
npm run db:up        # starts Postgres 17 + S3-compatible storage in Docker
npm run env:check    # validates the API settings
npm run dev          # API on :4000 + web on :3000 (from issues #5 and #6)
npm run check        # format check + lint + typecheck + unit tests
npm run test:int     # integration tests against the mom_test database
```

### Local services (`docker-compose.yml`)

| Service    | Image                      | Address                                      | Data volume   |
| ---------- | -------------------------- | -------------------------------------------- | ------------- |
| PostgreSQL | `postgres:17.12-alpine`    | `localhost:5432` (dbs `mom`, `mom_test`)     | `mom_pg_data` |
| S3 storage | `chrislusf/seaweedfs:4.54` | `http://localhost:8333`, bucket `mom-images` | `mom_s3_data` |

Both listen on `127.0.0.1` only. MinIO, the usual choice, no longer publishes Docker
images, so local S3 uses [SeaweedFS](https://github.com/seaweedfs/seaweedfs). On AWS it is replaced by real S3 + CloudFront (#28).
Database commands: `db:down` (stop, data kept), `db:reset` (⚠ wipe, migrate and seed demo data),
`db:migrate`, `db:seed`, `db:psql`, `db:logs`.

### Web app (`apps/web`)

Next.js 16 (App Router, Turbopack) + Tailwind CSS 4 + TanStack Query. `npm run dev` serves it on
<http://localhost:3000>.

| Area        | Routes                                                             | Layout                                   |
| ----------- | ------------------------------------------------------------------ | ---------------------------------------- |
| Student     | `/`, `/orders`, `/profile`                                         | header + bottom tab bar (phones first)   |
| Stall       | `/vendor`, `/vendor/scan`, `/menu`, `/sales`, `/settings`          | side rail on tablets, tab bar on phones  |
| Admin       | `/admin`, `/admin/revenue`, `/stalls`, `/users`, …                 | sidebar on desktop, menu sheet on phones |
| Style guide | `/dev/components` (hidden in production unless `SHOW_DEV_PAGES=1`) | every component, light and dark          |

Design tokens (colour, type, radii) are CSS variables in `src/app/globals.css`, with light and dark
themes. `src/lib/api-client.ts` is the typed client for the API (errors become `ApiError`).
**Home (#11):** stall cards (open → paused → closed, greyed with "Opens 7:30 AM" in IST), busy meter,
"Closes in 20 min", payment methods and starting price; search by stall, cuisine or **dish**;
"Open now" and "Pure veg" filters; refreshed every 30 s, pull-to-refresh and a refresh button.

**Sign-in (#8):** `/login` (phone → 6-box code with paste/SMS autofill → name on first login).
The API client renews the 15-minute session silently (one shared refresh for parallel requests);
`/vendor` needs a stall role and `/admin` a super admin, others see `/no-access`. These guards are UX
only — the API enforces access on every request.

Browser tests: `npm run e2e -w @mom/web` builds the app, starts the real API against `mom_test`
(needs `npm run db:up`) and runs Playwright: real sign-ins with fixed test codes, role redirects,
silent refresh, axe WCAG 2.1 AA checks in both themes, no sideways scroll at 360 px. Also in CI.

### API (`apps/api`)

Fastify 5 + Zod. `npm run dev` serves it on <http://localhost:4000>:

| Path                                            | Purpose                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /health`                                   | liveness (process is up)                                                        |
| `GET /ready`                                    | readiness: 200 if Postgres answers, 503 if not (load balancer uses it)          |
| `/docs`                                         | interactive OpenAPI docs (not served in production)                             |
| `POST /v1/auth/otp/request`, `/otp/verify`      | phone OTP login (sets httpOnly session cookies)                                 |
| `POST /v1/auth/refresh`, `/logout`              | rotate / end the session                                                        |
| `GET`, `PATCH`, `DELETE /v1/me`                 | the signed-in user (name; account deletion)                                     |
| `GET /v1/stalls`, `/v1/stalls/:slug`            | public: stalls with open/paused/closed, wait time + busy level, payment methods |
| `GET /v1/vendor/stalls`, `/stalls/:stallId`     | stall console: my stalls (members) / all (super admin)                          |
| `POST`, `GET /v1/admin/stalls/:stallId/members` | super admin: register a stall owner's phone, list members + pending             |
| `POST /v1/admin/users/:userId/suspension`       | super admin: suspend (ends all sessions) or reactivate                          |

**Login (#7):** 6-digit SMS codes stored only as HMAC hashes, valid 5 min, 5 tries, 30 s resend
cooldown, 5 codes per phone and 30 per IP per hour. Sessions: 15-min JWT access cookie + 30-day
rotating refresh cookie (`path=/v1/auth`); reusing an old refresh token revokes the session. Cookies
are httpOnly + SameSite=Lax, and state-changing requests from other origins are refused.
Locally the code is printed in the API terminal (`SMS_PROVIDER=console`).

**Access (#9):** `requireRole(...)` checks the token's role; `requireStallAccess()` checks stall
membership in the database on every request (403 for any stall you don't manage — even unknown ids).
Stall owners are pre-registered by phone: existing accounts get access at once, new ones on first
sign-in. `SUPER_ADMIN_PHONES` are promoted at sign-in. Every admin change goes to the append-only
audit log. An authorization matrix test covers 5 kinds of caller × 6 endpoints.

**Stall status (#10):** open/closed comes from weekly hours in IST (several slots a day, slots past
midnight), the vendor's "Open now/Close now" switch (reset at midnight by a pg-boss job) and the
"pause orders" switch. Wait = ceil((active orders + 1) / capacity) × prep time; Low/Moderate/Busy
thresholds come from platform settings. The public list is cached for 15 s. Background jobs run on
pg-boss (queue in Postgres, `JOBS_ENABLED`); if the database is down at startup the API stays up and
retries.

Errors always look like `{ "error": { "code", "message", "details?" }, "requestId" }`.
Security headers, CORS (only `WEB_ORIGIN`) and per-IP rate limits apply to every route.
Container: `docker build -f apps/api/Dockerfile -t mom-api .` (non-root, ~58 MB compressed);
`node dist/migrate.js` runs migrations as a one-off task.

### Database schema

Defined with Drizzle in [`apps/api/src/db/schema/`](apps/api/src/db/schema) (spec §8); SQL migrations live in
[`apps/api/drizzle/`](apps/api/drizzle). To change the schema: edit the schema files → `npm run db:generate -w @mom/api`
→ review the new SQL → `npm run db:migrate` → commit both. CI fails if the two are out of sync.
`npm run db:studio -w @mom/api` opens a browser view of the data.

A beginner-friendly walkthrough lives in [quick_start.txt](quick_start.txt).

## Continuous integration

Every PR and every push to `main` runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

| Job                                 | What it runs                                                 |
| ----------------------------------- | ------------------------------------------------------------ |
| Lint, typecheck, unit tests & build | `format:check` → `lint` → `typecheck` → `npm test` → `build` |
| Integration tests (Postgres)        | `npm run test:int` against a `postgres:17.12-alpine` service |
| End-to-end tests (Playwright)       | skipped until #11                                            |

Both active jobs are **required** to merge into `main`. Dependabot opens grouped weekly
update PRs for npm packages, GitHub Actions and the Docker images.

## Status

| Milestone                   | Issues  | State          |
| --------------------------- | ------- | -------------- |
| M0 Foundation               | #1–#6   | 🚧 in progress |
| M1 Identity                 | #7–#9   | ⏳             |
| M2 Student ordering         | #10–#17 | ⏳             |
| M3 Stall console            | #18–#22 | ⏳             |
| M4 Super admin              | #23–#27 | ⏳             |
| M5 Deployment & launch, AWS | #28–#30 | ⏳             |
