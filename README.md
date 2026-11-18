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

**Menu (#12):** `/stalls/:slug` — stall header (status, wait, closing time, payments), sticky
category chips that follow the scroll, dish rows (photo, veg mark, price, Add / − +), a dish detail
sheet, "Sold out" dishes that can't be added, and a banner when the stall is closed or paused. One
stall per cart: adding from another stall asks first. A 50-dish menu is tested at 4× CPU slowdown.

**Stall settings (#20):** `/vendor/settings` (owners only). Open or closed: Follow hours / Open
now / Closed now (the override resets at midnight IST) and a "Take new orders" pause switch, with a
plain-words status line. Payment methods: UPI can only be switched on once the Razorpay settlement
account is `activated` (otherwise "Settlement account pending"), and at least one way to pay must
stay on. Weekly hours editor (several slots a day, overnight slots, "Use for every day"; overlaps
refused, including Sunday night into Monday). Kitchen speed (prep minutes, orders at once) feeds the
wait-time meter. Stall photo (same signed upload as dishes, `stalls/<id>/cover/`), description and
location. Every change is audited and clears the public stall-list cache, so students see it on
their next load; checkout greys out a payment method the stall turned off.

**Menu editor (#19):** `/vendor/menu` (stall owners only; counter staff see a note). Categories:
add, rename, reorder, delete when empty. Dishes: name, description, price in ₹, veg/non-veg, photo,
availability switch on every row, reorder, soft delete; "Mark all available" in one tap. Price
changes are audited (who, before, after). Photos are shrunk in the browser to ≤ 1200 px WebP (JPEG
where WebP can't be encoded), then uploaded straight to S3 with a 5-minute presigned PUT whose size
and type are signed, so storage refuses anything else. The API picks the key
(`stalls/<stallId>/items/<uuid>.webp`); saving a dish checks the key is in that stall's folder and
that the uploaded object really is a ≤ 2 MB WebP/JPEG/PNG. Replaced or removed photos are deleted.

**Stall order board (#18):** `/vendor` shows New → Preparing → Ready (columns on tablets, tabs on
phones), live over the stall's own event stream (no student ids are sent to stalls). Each ticket shows
the token, dishes, the student's note, "UPI paid" or "Cash due ₹X" and how long it has waited
(flagged after 15 min). Accept, Mark ready (also straight from New for instant items) and Reject with
a reason; transitions are enforced and audited on the server, repeat taps are harmless, and
rejecting a paid UPI order refunds it in full (if the refund can't start it's marked refund pending
for a retry). A chime plays for each new order once "Turn on order sound" has been tapped, and the
tab title shows "(N)" new orders.

**Live status & My orders (#17):** a Postgres trigger sends `NOTIFY mom_orders` whenever an order's
status, payment or token changes; each API process holds one `LISTEN` connection and fans changes out
over Server-Sent Events (`GET /v1/orders/events`) to the student (and, from #18, the stall). Events
carry ids: a browser that reconnects with `Last-Event-ID` gets what it missed, otherwise it is told
to resync and refetches. A heartbeat every 25 s keeps proxies from closing the stream (**the AWS load
balancer's idle timeout must be above 25 s**, #28). `/orders` shows active orders live and past ones
(keyset-paginated, "Order again" refills the cart, the cart page re-checks prices). When an order
turns ready the token screen goes full green with a buzz and chime and the tab title flashes; on other
pages a notice pops up. Students can cancel until the stall starts preparing (paid UPI → refunded).

**Token & QR (#16):** placed orders carry a signed pickup QR `MOM1.<orderId>.<sig>` (HMAC-SHA256 with
`QR_SECRET`, 128-bit, ≈64 chars → a small, quickly scanned code); `verifyPickupQr()` is what the stall
scanner uses (#21). The order screen shows the token ticket, the QR (black on white, also in dark
mode), the pickup code, a Placed → Preparing → Ready → Collected stepper, keeps the screen awake while
the QR shows, and offers "Add to home screen" once on phones.

**Payments (#15):** Razorpay (no SDK; REST + Checkout). Paying creates a Razorpay order (reused on a
second tap); success is accepted only with a valid HMAC signature, and the same `confirmPayment()`
serves the browser and the webhook (first one wins, the other is a no-op): payment captured → token →
order placed → fee in the ledger. Unpaid UPI orders expire after 15 min (pg-boss, every minute); a
payment that arrives later is refunded automatically. `refundOrder()` reverses MOM's fee in the
ledger. Without Razorpay keys, UPI simply isn't offered. Tests use a fake gateway and a stubbed
Checkout that signs like Razorpay.

**Orders (#14):** one transaction: lock the student, re-price, refuse if the total differs from
what was shown, check stall/method/cash limits (2 open cash orders, strikes), snapshot fees, create
the order, and for cash issue the day's next token (atomic counter per stall and IST day) and a
4-digit pickup code. Retries with the same key return the same order (also under a race).
Ordering is rate-limited per student, not per IP (campus Wi-Fi shares IPs). Tested with 50
simultaneous orders → tokens 1…50.

**Cart (#13):** one stall per cart, saved in `localStorage` (survives reloads, synced across tabs),
note for the stall; floating "N items · ₹X — View cart" bar; `/cart` re-prices through the server on
every change, shows price changes (old → new, "Accept new prices"), sold-out/removed dishes to remove,
and the bill for UPI and for cash. The server's price always wins.

**Sign-in (#8):** `/login` (phone → 6-box code with paste/SMS autofill → name on first login).
The API client renews the 15-minute session silently (one shared refresh for parallel requests);
`/vendor` needs a stall role and `/admin` a super admin, others see `/no-access`. These guards are UX
only — the API enforces access on every request.

Browser tests: `npm run e2e -w @mom/web` builds the app, starts the real API against `mom_test`
(needs `npm run db:up`) and runs Playwright: real sign-ins with fixed test codes, role redirects,
silent refresh, axe WCAG 2.1 AA checks in both themes, no sideways scroll at 360 px. Also in CI.

### API (`apps/api`)

Fastify 5 + Zod. `npm run dev` serves it on <http://localhost:4000>:

| Path                                                                                                                                | Purpose                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                                                                                                       | liveness (process is up)                                                                                                         |
| `GET /ready`                                                                                                                        | readiness: 200 if Postgres answers, 503 if not (load balancer uses it)                                                           |
| `/docs`                                                                                                                             | interactive OpenAPI docs (not served in production)                                                                              |
| `POST /v1/auth/otp/request`, `/otp/verify`                                                                                          | phone OTP login (sets httpOnly session cookies)                                                                                  |
| `POST /v1/auth/refresh`, `/logout`                                                                                                  | rotate / end the session                                                                                                         |
| `GET`, `PATCH`, `DELETE /v1/me`                                                                                                     | the signed-in user (name; account deletion)                                                                                      |
| `GET /v1/stalls`, `/v1/stalls/:slug`                                                                                                | public: stalls with open/paused/closed, wait time + busy level, payment methods                                                  |
| `GET /v1/stalls/:slug/menu`                                                                                                         | public: categories → dishes (sold-out flagged; deleted and empty hidden)                                                         |
| `POST /v1/cart/quote`                                                                                                               | public: re-price a cart from the database → per-line status (ok, price changed, sold out, removed), UPI and cash bills, problems |
| `POST /v1/orders` (+ `Idempotency-Key`), `GET /v1/orders/:id`                                                                       | signed in: place an order (cash → token now; UPI → pending payment), view my order                                               |
| `GET /v1/orders?scope=active\|past&before=<orderId>`                                                                                | signed in: my orders — in progress, or finished (newest first, 20 per page)                                                      |
| `GET /v1/orders/events`                                                                                                             | signed in: live changes to my orders (text/event-stream, resumes with `Last-Event-ID`)                                           |
| `POST /v1/orders/:id/cancel`                                                                                                        | signed in: cancel before the stall starts preparing; a paid UPI order is refunded                                                |
| `POST /v1/payments/razorpay/order`, `/verify`                                                                                       | signed in: start paying a UPI order; verify Razorpay's signature → token                                                         |
| `POST /v1/webhooks/razorpay`                                                                                                        | Razorpay → MOM (signed): confirms payments even if the browser closed; de-duplicated                                             |
| `GET /v1/vendor/stalls/:stallId/orders` (+ `/events`)                                                                               | stall: the live board (active + finished today); live changes (text/event-stream)                                                |
| `POST /v1/vendor/stalls/:stallId/orders/:orderId/accept`, `/ready`, `/reject`                                                       | stall: move an order along; reject needs a reason and refunds paid UPI orders                                                    |
| `GET /v1/vendor/stalls/:stallId/menu`; `POST /categories`, `PATCH`/`DELETE /categories/:id`, `PUT /categories/order`                | stall owner: the menu editor; categories (delete only when empty; reorder sends every id)                                        |
| `POST /v1/vendor/stalls/:stallId/items`, `PATCH`/`DELETE /items/:id`, `PUT /categories/:id/items/order`, `POST /items/availability` | stall owner: dishes (price changes audited; soft delete); bulk available / sold out                                              |
| `GET`, `PATCH /v1/vendor/stalls/:stallId/settings`; `PUT /hours`                                                                    | stall owner: open/close/pause, payment methods, prep time, capacity, photo, details; replace weekly hours (all audited)          |
| `POST /v1/vendor/stalls/:stallId/uploads/presign`                                                                                   | stall owner: a 5-minute signed PUT into the stall's photo folder (WebP/JPEG/PNG, ≤ 2 MB)                                         |
| `GET /v1/vendor/stalls`, `/stalls/:stallId`                                                                                         | stall console: my stalls (members) / all (super admin)                                                                           |
| `POST`, `GET /v1/admin/stalls/:stallId/members`                                                                                     | super admin: register a stall owner's phone, list members + pending                                                              |
| `POST /v1/admin/users/:userId/suspension`                                                                                           | super admin: suspend (ends all sessions) or reactivate                                                                           |

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
