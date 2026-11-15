# MOM — Product & Engineering Specification (v1.0)

> **Status:** Draft for approval · **Date:** 14 Nov 2026 · **Owner:** Subhankar Patra
> **Scope of v1:** the full **web application** (student app, stall-owner console, super-admin console) running in production on **AWS**.
> The native mobile app is built **after** v1, on the same API.

---

## 1. Product summary

MOM is a pre-ordering platform for the food stalls around VSSUT. A student opens MOM and sees every
nearby stall with its **open/closed status** and **how busy it is**. They pick a stall, browse a
**digital menu with photos and prices**, add items to a cart and pay by **UPI** or **cash**.
They get a **token number and a QR code**, track the order live, and collect the food at the
counter. There the stall owner scans the QR code, or types in the token, to hand the food over.

The MOM team (super admin) onboards stalls, controls access, sets fees and tracks the
commission it earns from every order.

The UX patterns follow established campus and corporate food-ordering apps such as GoKhana:
outlet cards with status and wait time, a category-tabbed menu, a sticky cart bar, a token-based
order tracker and a vendor order board. **The name, branding, colours and artwork are MOM's own.**

### 1.1 Goals for v1

| #   | Goal                                                                              | Measure                                         |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| G1  | A student can go from opening the site to holding a token in **under 60 seconds** | Median time-to-token in analytics               |
| G2  | **Zero** wrong or duplicate tokens, and zero orders paid but missing              | Reconciliation job reports 0 mismatches         |
| G3  | A stall can run the whole day from **one phone or tablet**                        | Vendor console works on a 360 px wide screen    |
| G4  | MOM's commission is tracked **to the paisa**, for every vendor, every day         | Ledger matches the sum of the orders' fee lines |
| G5  | Production-grade: backups, monitoring, staging and prod environments, CI/CD       | Launch checklist (Issue #30) is all green       |

### 1.2 Out of scope for v1 (roadmap)

Native Android/iOS app · push notifications · ratings and reviews · coupons and offers · scheduled
(pre-book for later) orders · delivery · multi-campus · loyalty.

---

## 2. Where we are: the prototype review

The prototype built so far (Supabase, Next.js and Expo) proved out the core flow. It is **retired
as a codebase** and kept for reference under the git tag `prototype-v0` (Issue #1).

| Area                                  | Prototype                                                | v1 decision                                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend                               | Supabase (Postgres, RLS, Edge Functions) in local Docker | **Replace** with our own API on AWS (ECS + RDS Postgres). We **reuse** the logic: integer-paise money, fees computed on the server, a row-locked daily token counter, and an idempotent payment confirmation |
| Auth                                  | Email OTP                                                | **Replace** with **phone-number OTP**                                                                                                                                                                        |
| Fees                                  | Online 1% / offline 5%                                   | **Change**: UPI = platform fee; cash = platform fee + cash-handling fee (see §4)                                                                                                                             |
| Student web                           | Stall list, menu, cart, token, live status               | **Rebuild** with open/closed status, a congestion meter, item photos and a QR code                                                                                                                           |
| Vendor web                            | Live order board, menu editor                            | **Rebuild** with image upload, payment-method settings, QR scanner and token check                                                                                                                           |
| Admin web                             | Basic stats, fee settings, owner linking                 | **Rebuild** as a full console: revenue, ledger, settlements, access control, audit log                                                                                                                       |
| Mobile (Expo)                         | Student app                                              | **Paused** until v1 web ships. It will reuse the v1 API                                                                                                                                                      |
| Local Docker volumes `supabase_*_mom` | Prototype data                                           | Removed once Issue #2 sets up the new local stack                                                                                                                                                            |

---

## 3. Users, roles and permissions

| Role                          | Who                 | How they get the role                                             | Can access                                                            |
| ----------------------------- | ------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `student`                     | Anyone who signs in | Automatic on first OTP login                                      | Browse, order, pay, view own orders                                   |
| `vendor_owner`                | Stall owner         | **Super admin pre-registers the phone number** against a stall    | Only **their own stall(s)**: orders, menu, settings, scanner, reports |
| `vendor_staff` _(v1.1-ready)_ | Counter helper      | Owner invites a phone number                                      | Orders board and scanner only; no menu, prices or finance             |
| `super_admin`                 | MOM team            | Seeded from an environment allowlist, then managed in the console | Everything, every action audited                                      |

**Rules**

- One phone number = one account. Its role is decided on the server, never by the client.
- A `vendor_owner` can own several stalls. Every vendor API call is scoped by `stall_id`, and the
  server checks `stall_members(user_id, stall_id)`. **Integration tests prove that vendor A can't
  read or write stall B** (Issue #9).
- Vendor numbers are pre-registered. If an unknown number logs in, it becomes a student. If a
  pre-registered number logs in, it lands in the vendor console.
- A super admin can **suspend** any user or stall. Suspended users are signed out within 15 minutes:
  that is the access-token lifetime, and refresh tokens are revoked immediately.

---

## 4. Money: fees, payments, commission

### 4.1 Fee rules (configurable in the admin console, versioned)

| Payment method        | Student pays                                                              | MOM keeps               | Stall receives                                                         |
| --------------------- | ------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| **UPI** (online)      | subtotal + **platform fee** (default **1%**)                              | platform fee            | subtotal                                                               |
| **Cash** (at counter) | subtotal + **platform fee** (1%) + **cash-handling fee** (default **5%**) | platform fee + cash fee | subtotal (collects the full total in cash, then **owes MOM the fees**) |

- All amounts are **integers in paise**. Each fee = `round_half_up(subtotal × pct / 100)` and is
  calculated **separately** and shown as its own line on the bill.
- The fee percentages **in force when the order is placed** are copied onto the order, so changing
  the fees later never changes old orders.
- Example: subtotal ₹130.00
  - UPI: 130.00 + 1.30 = **₹131.30**
  - Cash: 130.00 + 1.30 + 6.50 = **₹137.80**

### 4.2 UPI flow (Razorpay)

1. `POST /orders` creates the order as `pending_payment` and creates a Razorpay order for the total.
2. The browser opens Razorpay Checkout with UPI first (intent or QR collect).
3. The client sends back `razorpay_order_id|razorpay_payment_id|signature`. The server **verifies
   the HMAC**, then confirms the payment **idempotently**: it issues the token and sets the order
   to `placed`.
4. The **webhook** (`payment.captured`, `order.paid`) is the source of truth if the browser closes.
   It runs the same idempotent confirmation.
5. Unpaid orders **expire after 15 minutes** (a background job).
6. **Settling with the stall:** we use **Razorpay Route** and give each stall a _linked account_.
   On confirmation, the server creates a transfer of `subtotal` to the stall, and the platform fee
   stays with MOM. Transfers are held until hand-over and released when the order is
   `collected`. That way a refund for a stall-rejected order never needs money back from the stall.
7. If the stall rejects the order, or MOM cancels it: we refund in full through the Refunds API,
   the order becomes `refunded`, and a ledger entry is written.

### 4.3 Cash flow

- The token is issued **immediately**. The payment status is `due`.
- At hand-over the vendor scans the QR code, collects the cash and taps **"Cash received"**. The
  payment becomes `paid_cash` and the order becomes `collected`.
- The ledger records a **receivable from the stall** (platform fee + cash fee). Receivables are
  **netted against the stall's next UPI transfers**, or settled weekly (Issue #26).
- **Abuse controls:** at most **2 open cash orders per student**. Each no-show adds a strike, and
  after 3 strikes cash is disabled for that student (an admin can reset this). A vendor can turn
  cash off for their stall at any time.

### 4.4 Commission ledger (double-entry style, append-only)

Every money event writes immutable `ledger_entries` rows:
`order_id, stall_id, type (platform_fee | cash_fee | refund_reversal | settlement | adjustment),
amount_paise, direction, created_at`.

The **revenue dashboard** and **stall statements** are built only from the ledger, never by
re-adding up the orders. A nightly **reconciliation job** compares the ledger, the orders and the
Razorpay settlements, and raises an alert on any mismatch.

> ⚠️ **Business checks before launch** (see §13):
>
> - Payment gateways commonly charge around 2% per transaction on standard plans. Confirm
>   Razorpay's current UPI pricing for MOM: if the gateway charges more than 1%, the 1% platform
>   fee loses money on every UPI order.
> - Route and live keys require **KYC for a business entity**.
> - Once revenue crosses the GST threshold, **GST** applies to MOM's fees.

---

## 5. Order lifecycle

```
                 UPI path                                   Cash path
POST /orders ──► pending_payment ──(paid)──┐     POST /orders ──► placed (payment: due)
                    │(15 min) ► expired      │                         │
                                             ▼                         ▼
                                          placed ──(vendor accepts)──► preparing ──► ready ──(scan/token)──► collected
                                             │                            │            │
                                             └──── rejected / cancelled ◄─┴────────────┘ (vendor/admin; UPI ⇒ refunded)
```

| Status            | Set by                                     | Student sees                                         |
| ----------------- | ------------------------------------------ | ---------------------------------------------------- |
| `pending_payment` | system                                     | "Complete payment" with a Pay button and a countdown |
| `placed`          | system                                     | Token, QR code, "Waiting for the stall to accept"    |
| `preparing`       | vendor                                     | "Being prepared" and the estimated time              |
| `ready`           | vendor                                     | Green screen: "Ready! Show your QR at the counter"   |
| `collected`       | vendor, via scan or token check            | "Enjoy your meal" and the receipt                    |
| `rejected`        | vendor (with a reason: item out, closing…) | Reason and refund status                             |
| `cancelled`       | student (only before `preparing`) / admin  | Refund status                                        |
| `expired`         | system                                     | "Payment not completed"                              |

**Token:** a per-stall, per-day counter (Asia/Kolkata time). It starts at 1 each day and is issued
under a row lock, so it is never duplicated. It is displayed as `#23`.

**Pickup code:** a random 4-digit code for each order. Typing a token alone is not enough, because
tokens are sequential and easy to guess. The manual check needs **token + pickup code**.

**QR payload:** `MOM1.<orderId>.<hmac>` (signed with a server secret). The scanner sends it to
`POST /vendor/pickup/verify`. The server checks the signature, that the order belongs to the
scanning stall, that the status is `ready` (or `placed`/`preparing`, with a warning) and that the
order hasn't been collected yet.

---

## 6. Feature specification

### 6.1 Student web (mobile-first PWA)

| #   | Feature         | Details                                                                                                                                                                                                                                                                                                         |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **Phone login** | +91 number → 6-digit OTP (SMS) → name, only on first login. The session lasts 30 days                                                                                                                                                                                                                           |
| S2  | **Stalls home** | Cards with photo, name, cuisine tags, veg/non-veg badge, location, **Open/Closed** chip (with "Opens at 5 PM"), a **congestion meter** (Low / Moderate / Busy, plus "~12 min wait") and accepted payment methods. Closed stalls are greyed out and sorted last. Search by stall or dish, plus a veg-only filter |
| S3  | **Stall menu**  | Header (status, wait, timings), sticky **category tabs**, items with **photo**, name, description, price, veg dot and an _Add_ / − + stepper. Unavailable items show "Sold out". An item opens in a detail sheet with a larger photo                                                                            |
| S4  | **Cart**        | One stall per cart (prompts to replace when switching stalls). It persists across reloads. A sticky "View cart · 3 items · ₹180" bar. The cart is re-priced by the server before checkout, and any price changes are shown                                                                                      |
| S5  | **Checkout**    | Only the payment methods the stall has enabled. A UPI/Cash selector with a **live bill breakdown** (items, platform fee, cash fee, total) and an optional note to the stall. Cash is blocked if the student has too many open cash orders or no-show strikes                                                    |
| S6  | **Token & QR**  | Full-screen token `#23`, **QR code**, pickup code, stall name and location, and a live status stepper                                                                                                                                                                                                           |
| S7  | **Orders**      | Active orders on top, updating live, then history. Order detail, the receipt, and **Reorder**                                                                                                                                                                                                                   |
| S8  | **Profile**     | Name, phone (read-only), and sign out. Also delete account (DPDP) and links to the legal pages                                                                                                                                                                                                                  |

### 6.2 Stall-owner console (`/vendor`, tablet- and phone-friendly)

| #   | Feature                    | Details                                                                                                                                                                                                                               |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | **Login**                  | Same phone OTP. Only pre-registered numbers get vendor access                                                                                                                                                                         |
| V2  | **Stall switcher**         | Only if they own several stalls. Every page is scoped to the selected stall                                                                                                                                                           |
| V3  | **Live order board**       | Columns New → Preparing → Ready, with a sound and a badge for new orders. Each card shows the token, items, note, payment (UPI paid / **Cash due ₹137.80**) and the elapsed time. Actions: Accept, Reject (with a reason), Mark ready |
| V4  | **Pickup verification**    | **Camera QR scanner**, plus manual **token + pickup code** entry. Shows the order with a big ✅/❌. Buttons: "Hand over", and for cash orders "Cash received ₹X"                                                                      |
| V5  | **Menu management (CRUD)** | Categories (add, rename, reorder), items (name, description, price, veg flag, **image upload**, availability toggle, sort order). Bulk "mark all available". Price changes are audited                                                |
| V6  | **Stall settings**         | Open/close now; **pause new orders**; weekly opening hours; average prep time and parallel capacity, which feed the congestion meter; stall photo, description and location                                                           |
| V7  | **Payment methods**        | Turn UPI and Cash on or off. Turning UPI on needs an active Razorpay linked account. Shows the status of the settlement account (bank/UPI)                                                                                            |
| V8  | **Sales & dues**           | Today, week and month: order count, gross sales, UPI vs cash, **fees owed to MOM** (cash), transfers received. CSV export                                                                                                             |

### 6.3 Super-admin console (`/admin`)

| #   | Feature                  | Details                                                                                                                                                                                                    |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Overview dashboard**   | Today: orders, GMV, **MOM revenue**, active stalls, live orders, failed payments, and the reconciliation status                                                                                            |
| A2  | **Revenue & commission** | Revenue by day, week and month; **per-vendor commission** (platform fee vs cash fee); top stalls; UPI/cash mix. Charts and CSV export. Built from the ledger                                               |
| A3  | **Stalls & vendors**     | Create, edit or suspend stalls. **Register the owner's phone number**, start the Razorpay linked-account onboarding, see the stall's status, settings and menu (read-only, or edit on behalf of the stall) |
| A4  | **Users & access**       | Search users by phone or name. View their orders. Change roles, suspend, reset cash strikes, force sign-out. Manage the super-admin list                                                                   |
| A5  | **Orders**               | Search and filter every order. Open the full timeline. Cancel or refund with a reason                                                                                                                      |
| A6  | **Settlements**          | Per stall: UPI transfers, cash receivables, net balance; mark a cash settlement received. Weekly statements                                                                                                |
| A7  | **Platform settings**    | Fee percentages (versioned, with an effective-from time), cash-order limits, order expiry, congestion thresholds, feature flags (e.g. `cash_enabled_globally`)                                             |
| A8  | **Audit log**            | Every admin and vendor change: who, what, before and after, when, and IP address. Read-only                                                                                                                |

---

## 7. System architecture (AWS, region `ap-south-1` Mumbai)

```
                ┌──────────────────────────── AWS (ap-south-1) ─────────────────────────────┐
 Students /     │                                                                            │
 Vendors /  ──► │  Route 53 ─► AWS Amplify Hosting (Next.js web, CDN, PR previews)           │
 Admins         │       │                                                                    │
  (browser)     │       └────► api.<domain> ─► AWS WAF ─► ALB ─► ECS Fargate: API (Node/TS)  │
                │                                              │  x2 tasks, autoscaling      │
                │                                              ├─► RDS PostgreSQL 17 (Multi-AZ in prod, PITR)
                │                                              │     • pg-boss job queue      │
                │                                              │     • LISTEN/NOTIFY → SSE    │
                │                                              ├─► S3 (menu images) ─► CloudFront (img.<domain>)
                │                                              ├─► Secrets Manager / SSM     │
                │                                              └─► End User Messaging SMS (OTP, India DLT)
                │  CloudWatch logs, metrics, alarms · AWS Budgets · Backups                   │
                └────────────────────────────────────────────────────────────────────────────┘
                         ▲ Razorpay webhooks (HTTPS)        GitHub Actions ─(OIDC)─► deploy
```

### 7.1 Technology choices

| Layer         | Choice                                                                                                               | Why                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Repo          | **Monorepo**, npm workspaces: `apps/web`, `apps/api`, `packages/shared`, `infra`                                     | One PR can change the API and the UI together. Types and fee maths are shared                               |
| Web           | **Next.js (App Router) + TypeScript + Tailwind CSS**, PWA                                                            | Already known from the prototype. Three surfaces in one app via route groups `(student)`, `vendor`, `admin` |
| API           | **Node.js 24 LTS + Fastify + TypeScript + Zod**, OpenAPI generated from the schemas                                  | Fast, simple, typed; the same API serves the future mobile app                                              |
| DB            | **PostgreSQL 17 on Amazon RDS**, **Drizzle ORM** + SQL migrations                                                    | Relational money data and transactions. Row locks for tokens                                                |
| Realtime      | **Server-Sent Events** from the API, fanned out with Postgres `LISTEN/NOTIFY`                                        | No extra infrastructure, works through the ALB, auto-reconnects                                             |
| Jobs          | **pg-boss** (job queue in Postgres)                                                                                  | Order expiry, reconciliation, stall auto-open/close, transfers. No extra service needed                     |
| Auth          | Our own **phone OTP** + JWT access token (15 min) + rotating refresh token (30 days) in httpOnly cookies             | Full control of roles and pre-registration; portable to the mobile app                                      |
| SMS           | **AWS End User Messaging SMS** with India **DLT** registration. A provider interface allows a fallback such as MSG91 | On AWS credits; DLT is legally required for SMS in India                                                    |
| Images        | **S3** (private) + **CloudFront** (OAC), uploads via presigned URLs, compressed in the browser to WebP ≤ 1200 px     | Cheap, fast, secure                                                                                         |
| Payments      | **Razorpay** Checkout (UPI first) + webhooks + **Route** + Refunds API                                               | Indian UPI coverage; splits money between MOM and the stalls                                                |
| Infra as code | **AWS CDK (TypeScript)**                                                                                             | The same language as the app; reviewable in PRs                                                             |
| CI/CD         | **GitHub Actions** → (OIDC, no stored AWS keys) → ECR/ECS + Amplify                                                  | Every PR is tested; merging to `main` deploys to staging; a tagged release deploys to prod                  |
| Testing       | **Vitest** (unit), API integration tests against a real Postgres, **Playwright** (end-to-end)                        | Money and permission rules must be tested                                                                   |
| Monitoring    | CloudWatch logs and alarms, structured JSON logs (pino) with request IDs, a health endpoint, AWS Budgets alerts      | Production basics                                                                                           |

### 7.2 Environments

| Env       | Purpose                                                      | Data                                                           | Deploys                                  |
| --------- | ------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------- |
| `local`   | Development on the Mac                                       | Docker Compose: Postgres + MinIO (S3) + a console SMS provider | `npm run dev`                            |
| `staging` | Testing a merged PR with real AWS and Razorpay **test mode** | Seed data                                                      | On every merge to `main` (set up in #28) |
| `prod`    | Real students                                                | Real data, Multi-AZ, backups                                   | On a git tag `v*` + manual approval      |

### 7.3 Cost guardrails (AWS credits until June 2027)

- **AWS Budgets** alerts at 50%, 80% and 100% of a monthly limit.
- Staging is small (single-AZ RDS `t4g.micro`, 1 Fargate task) and can be scaled to zero at night.
- No NAT Gateway: the Fargate tasks run in public subnets behind tight security groups, and VPC
  endpoints are used where needed.
- **Before credits end:** do a cost review in **April 2027** (a recurring checklist item).

### 7.4 Security & compliance

- OTP: 6 digits, stored hashed, valid 5 minutes, max 5 attempts, 30 s resend cooldown,
  max 5 per phone per hour, plus per-IP limits and WAF rate rules.
- RBAC checked in the API on every route; stall scoping enforced in the data-access layer.
- Input validation (Zod) on every endpoint; security headers; strict CORS; CSRF protection for
  cookie auth (SameSite plus an origin check).
- Secrets only in Secrets Manager. RDS and S3 encrypted. Least-privilege IAM. GitHub OIDC.
- Payments: HMAC verification, webhook signature checks, idempotency keys on `POST /orders`
  and on payment confirmation.
- Audit log for every privileged action.
- **DPDP Act 2023 (India)**: privacy notice, minimal data (phone + name), account deletion,
  data kept only as long as needed. Razorpay stores the card and UPI data, not MOM.
- Legal pages required by Razorpay: Terms, Privacy, Refund & Cancellation, Contact.

---

## 8. Data model (v1)

| Table               | Key columns                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`             | id, phone (E.164, unique), name, role, status (active/suspended), cash_strikes, created_at                                                                                                                                                                                                                    |
| `auth_otps`         | id, phone, code_hash, expires_at, attempts, consumed_at, ip                                                                                                                                                                                                                                                   |
| `refresh_tokens`    | id, user_id, token_hash, family_id, expires_at, revoked_at                                                                                                                                                                                                                                                    |
| `vendor_invites`    | phone, stall_id, role, invited_by, accepted_at — _pre-registration_                                                                                                                                                                                                                                           |
| `stall_members`     | stall_id, user_id, role (owner/staff)                                                                                                                                                                                                                                                                         |
| `stalls`            | id, slug, name, description, location, photo_key, cuisine_tags[], is_veg_only, status (active/suspended), is_open_override, accepting_orders, avg_prep_minutes, parallel_capacity, upi_enabled, cash_enabled, razorpay_account_id, route_status                                                               |
| `stall_hours`       | stall_id, weekday, opens_at, closes_at (multiple slots allowed)                                                                                                                                                                                                                                               |
| `menu_categories`   | id, stall_id, name, sort_order                                                                                                                                                                                                                                                                                |
| `menu_items`        | id, stall_id, category_id, name, description, price_paise, is_veg, image_key, is_available, sort_order, deleted_at                                                                                                                                                                                            |
| `platform_settings` | versioned rows: platform_fee_pct, cash_fee_pct, max_open_cash_orders, order_expiry_min, effective_from                                                                                                                                                                                                        |
| `token_counters`    | stall_id, day, last_token                                                                                                                                                                                                                                                                                     |
| `orders`            | id, user_id, stall_id, token_no, token_day, pickup_code, status, payment_method (upi/cash), payment_status (pending/paid/due/paid_cash/refunded/failed), subtotal_paise, platform_fee_paise, cash_fee_paise, total_paise, fee snapshot pcts, note, idempotency_key, timestamps for each status, reject_reason |
| `order_items`       | order_id, menu_item_id, name_snapshot, price_snapshot, qty, line_total                                                                                                                                                                                                                                        |
| `payments`          | id, order_id, provider, provider_order_id, provider_payment_id, amount, status, raw (jsonb)                                                                                                                                                                                                                   |
| `refunds`           | id, payment_id, amount, provider_refund_id, status, reason                                                                                                                                                                                                                                                    |
| `transfers`         | id, order_id, stall_id, provider_transfer_id, amount, status, on_hold                                                                                                                                                                                                                                         |
| `ledger_entries`    | id, order_id, stall_id, type, amount_paise, direction, created_at — append-only                                                                                                                                                                                                                               |
| `cash_settlements`  | id, stall_id, amount, period, received_by, note                                                                                                                                                                                                                                                               |
| `audit_log`         | id, actor_id, action, entity, entity_id, before, after, ip, at                                                                                                                                                                                                                                                |

Database constraints: `unique(stall_id, token_day, token_no)`;
`total = subtotal + platform_fee + cash_fee`; `price_paise > 0`; foreign keys everywhere.

---

## 9. API surface (v1, REST + SSE, prefix `/v1`)

| Area     | Endpoints                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth     | `POST /auth/otp/request` · `POST /auth/otp/verify` · `POST /auth/refresh` · `POST /auth/logout` · `GET /me` · `PATCH /me` · `DELETE /me`                                                                                                                                                                                                                                                           |
| Public   | `GET /stalls` (status, congestion, wait) · `GET /stalls/:slug` · `GET /stalls/:id/menu` · `GET /settings/fees`                                                                                                                                                                                                                                                                                     |
| Student  | `POST /cart/quote` · `POST /orders` (Idempotency-Key) · `GET /orders` · `GET /orders/:id` · `POST /orders/:id/cancel` · `POST /payments/razorpay/verify` · `GET /orders/:id/events` (SSE)                                                                                                                                                                                                          |
| Vendor   | `GET /vendor/stalls` · `GET /vendor/stalls/:id/orders` · `GET /vendor/stalls/:id/events` (SSE) · `POST /vendor/orders/:id/{accept,reject,ready,handover,cash-received}` · `POST /vendor/pickup/verify` · CRUD `/vendor/stalls/:id/categories`, `/items` · `POST /vendor/uploads/presign` · `PATCH /vendor/stalls/:id/settings` · `PUT /vendor/stalls/:id/hours` · `GET /vendor/stalls/:id/reports` |
| Admin    | `/admin/overview` · `/admin/revenue` · CRUD `/admin/stalls` · `POST /admin/stalls/:id/owners` · `/admin/users` · `/admin/orders` · `POST /admin/orders/:id/refund` · `/admin/settlements` · `/admin/settings` · `/admin/audit`                                                                                                                                                                     |
| Webhooks | `POST /webhooks/razorpay`                                                                                                                                                                                                                                                                                                                                                                          |
| Ops      | `GET /health` · `GET /ready`                                                                                                                                                                                                                                                                                                                                                                       |

Errors use one format: `{ error: { code, message, details? }, requestId }`.

---

## 10. Congestion meter & open/closed logic

**Is the stall open?**
`open = status = active AND (is_open_override ?? within stall_hours(now, Asia/Kolkata))`.

- `accepting_orders = false` means "Open, not taking orders right now".
- A background job flips the override back to "follow hours" at midnight.

**Estimated wait** = `ceil(active_orders / parallel_capacity) × avg_prep_minutes`
(`active_orders` counts orders that are `placed` or `preparing`).

**Meter levels** (thresholds configurable):

| Level       | Wait      |
| ----------- | --------- |
| 🟢 Low      | ≤ 10 min  |
| 🟡 Moderate | 11–20 min |
| 🔴 Busy     | > 20 min  |

The result is cached for 15 s and pushed over SSE to the stalls page.

**Later (v1.1):** learn `avg_prep_minutes` from the real accept → ready times.

---

## 11. Design system

- **Mobile-first**, works from 360 px wide. The vendor board is optimised for 768 px+ tablets.
  The admin console is for desktops but still usable on mobile.
- **Brand:** MOM's own palette, including a warm primary (food) and success green (ready).
  Every colour is a design token, with light and dark themes.
- **Components:** Button, IconButton, Card, StallCard, MenuItemRow, QtyStepper, VegDot,
  StatusChip, CongestionMeter, BottomSheet, Tabs, Toast, Skeleton, EmptyState, DataTable, Stat,
  Chart, QRCode, Scanner.
- **Accessibility:** WCAG 2.1 AA contrast, 44 px touch targets, keyboard navigation in the
  consoles, and status never shown by colour alone.
- **Performance budget:** stalls page LCP < 2.5 s on 4G, JS < 200 KB gzipped per route, and
  images lazy-loaded through CloudFront.

---

## 12. Engineering workflow

1. Pick the next issue (in order: dependencies are listed).
2. `git switch -c <issue#>-short-name` from an up-to-date `main`.
3. Code + tests. Run `npm run lint && npm run typecheck && npm test` locally.
4. Push, then open a PR with `Closes #<n>`. CI must pass.
5. Review: Claude self-reviews, you check the preview URL or test locally.
6. **Squash merge** → pull `main` → quick local smoke test → next issue.
   (Issues #1–#27 are built and tested **locally**. Automatic deploys to AWS begin at #28.)

- Branch protection on `main`: PR required, CI green, no force-push.
- Conventional commits (`feat:`, `fix:`, `chore:` …).
- **Definition of Done** for every issue:
  - the acceptance criteria pass;
  - tests are added;
  - there are no lint or type errors;
  - docs and `quick_start.txt` are updated if a workflow changed;
  - it works in the local stack (and, from #28 onwards, on staging).

---

## 13. Open questions & what we need from you

| #   | Item                                                                                                                                                 | Needed by issue |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Q1  | Confirm the **cash total = platform fee 1% + cash fee 5% (6% total)**, with both fees going to MOM                                                   | #14             |
| Q2  | GitHub repo name and visibility (proposal: `subhankar2004/mom`, **private**)                                                                         | #1              |
| Q3  | **AWS account access**: an IAM Identity Center user, or an admin IAM user for the first setup. Also install the AWS CLI                              | #28             |
| Q4  | **Domain name** (e.g. `mom-vssut.in`)                                                                                                                | #28 / #29       |
| Q5  | **Razorpay account**: test keys now; KYC (business entity or sole proprietorship, bank account) before live. Route activation must be requested      | #15 / #26       |
| Q6  | **SMS DLT registration** (entity ID, sender ID, OTP template). This takes days to weeks, so start early. Until then, staging uses test phone numbers | #28 / #29       |
| Q7  | Brand: logo, primary colour, tagline (or let Claude propose them)                                                                                    | #6              |
| Q8  | GST registration status and the business entity name for invoices                                                                                    | #25 / #30       |
| Q9  | First 3–5 pilot stalls: owner phone numbers, menus, photos, timings                                                                                  | #23 / launch    |

---

## 14. Milestones

| Milestone                  | Issues  | Outcome                                                             |
| -------------------------- | ------- | ------------------------------------------------------------------- |
| **M0 Foundation**          | #1–#6   | Repo, local Docker stack, CI, database, API skeleton, design system |
| **M1 Identity**            | #7–#9   | Phone OTP login, sessions, roles, vendor pre-registration           |
| **M2 Student ordering**    | #10–#17 | Stalls → menu → cart → UPI/cash → token + QR → live orders          |
| **M3 Stall console**       | #18–#22 | Order board, menu CRUD + images, settings, scanner, sales           |
| **M4 Super admin**         | #23–#27 | Onboarding, access, revenue, settlements, settings, audit           |
| **M5 Deployment & launch** | #28–#30 | AWS staging + CI/CD, hardened prod, QA, legal, go-live              |

---

## 15. Issue backlog (30 issues)

> Format: **Labels** · **Depends on** · Description · Tasks · Acceptance criteria.

### M0 — Foundation

#### #1 Repo bootstrap & monorepo structure

**Labels:** `chore`, `M0` · **Depends on:** —

Create the git repo and archive the prototype. Then set up the monorepo that every later issue
builds on.

**Tasks**

- [ ] `git init`, commit the prototype, tag `prototype-v0`, push to the GitHub repo (Q2)
- [ ] Move the prototype into `legacy/` (or delete it from `main` once the tag exists) and
      update the README
- [ ] npm workspaces: `apps/web`, `apps/api`, `packages/shared`, `infra`
- [ ] Shared `tsconfig`, ESLint, Prettier, `.editorconfig`, `.nvmrc` (Node 24 LTS)
- [ ] `CONTRIBUTING.md` (branch → PR → squash merge flow), PR template, issue templates, labels, milestones
- [ ] Branch protection on `main`

**Acceptance criteria**

- `npm install && npm run lint && npm run typecheck` pass at the root on a clean clone.
- Tag `prototype-v0` exists on GitHub.

#### #2 Local development stack (Docker Compose)

**Labels:** `chore`, `M0` · **Depends on:** #1

**Tasks**

- [ ] `docker-compose.yml`: Postgres 17 (volume `mom_pg_data`) and MinIO (volume `mom_s3_data`)
      with a bucket auto-created
- [ ] `.env.example` for each app, plus typed env validation (Zod) that fails fast
- [ ] Root scripts: `dev` (API + web together), `db:up`, `db:down`, `db:reset`, `db:migrate`, `db:seed`
- [ ] Console SMS provider: the OTP is printed in the API logs during local development
- [ ] Stop the old Supabase stack and remove the `supabase_*_mom` volumes (after confirming with you)
- [ ] Rewrite `quick_start.txt` for the new stack

**Acceptance criteria**

- A new clone runs with `npm run db:up && npm run dev` and serves the web app on :3000 and the API on :4000.

#### #3 CI pipeline (GitHub Actions)

**Labels:** `ci`, `M0` · **Depends on:** #1

**Tasks**

- [ ] Workflow on PRs: install (cached) → lint → typecheck → unit tests → build
- [ ] A Postgres service container for API integration tests
- [ ] Playwright job, skipped until #11
- [ ] Required status checks on `main`; Dependabot for npm and actions

**Acceptance criteria**

- A PR with a lint error is blocked.
- A clean PR shows all checks green in under 10 minutes.

#### #4 Database schema v1 & migrations

**Labels:** `backend`, `db`, `M0` · **Depends on:** #2

**Tasks**

- [ ] Drizzle schema for every table in §8, with constraints, indexes and foreign keys
- [ ] Migrations folder plus `db:migrate` in CI
- [ ] Seed: a super admin from the env var, 4 demo stalls with categories, items and hours, and the default fee settings
- [ ] `packages/shared`: money helpers (`paise`, `formatINR`, `calcFees`) with unit tests,
      including the rounding cases

**Acceptance criteria**

- `db:reset` builds the schema and seed from scratch.
- `calcFees` tests cover ₹130 → UPI ₹131.30 and cash ₹137.80.

#### #5 API skeleton (Fastify)

**Labels:** `backend`, `M0` · **Depends on:** #4

**Tasks**

- [ ] Fastify app with plugins: config, db, pino logger with request ID, error handler (§9 format),
      Zod type provider, OpenAPI docs at `/docs` (non-prod only), helmet, CORS, rate-limit
- [ ] `GET /health` and `GET /ready` (the latter checks the DB)
- [ ] Test harness: spin up the app against a test DB with transaction rollback per test
- [ ] Dockerfile (multi-stage, non-root user, about 150 MB or less)

**Acceptance criteria**

- `docker build` works.
- `/ready` returns 200 with the DB up and 503 with it down.
- An example test passes in CI.

#### #6 Design system & app shell (web)

**Labels:** `frontend`, `design`, `M0` · **Depends on:** #1

**Tasks**

- [ ] Next.js app in `apps/web` with Tailwind and design tokens (light and dark), fonts, MOM logo/brand (Q7)
- [ ] The component library from §11, built as needed, plus a `/dev/components` showcase page
- [ ] Layouts:
  - student (bottom tab bar: Home, Orders, Profile)
  - vendor (side or bottom nav and a stall switcher)
  - admin (sidebar)
- [ ] Typed API client (generated from OpenAPI or hand-written in `packages/shared`), React Query setup
- [ ] PWA manifest, icons, theme colour

**Acceptance criteria**

- The showcase page renders every component in both themes, with no horizontal scroll at 360 px.
- Lighthouse a11y ≥ 95.

### M1 — Identity

#### #7 Phone OTP authentication (API)

**Labels:** `backend`, `auth`, `M1` · **Depends on:** #5

**Tasks**

- [ ] `POST /auth/otp/request`, `/verify`, `/refresh`, `/logout`, `GET/PATCH/DELETE /me`
- [ ] OTP rules from §7.4 (hashing, expiry, attempts, cooldowns, per-phone and per-IP limits)
- [ ] JWT access token (15 min) + rotating refresh tokens (30 days, reuse detection revokes the
      whole family) in httpOnly Secure cookies
- [ ] `SmsProvider` interface with three implementations:
  - console (local)
  - AWS End User Messaging SMS (DLT entity, template ID) — written and unit-tested here, switched on in #28
  - an allowlist of test numbers with a fixed OTP (staging only)
- [ ] Validate Indian phone numbers (+91, 10 digits, starting with 6–9)
- [ ] Tests: happy path, wrong code, expired code, rate limit, refresh-token reuse

**Acceptance criteria**

- Full login works locally with the OTP from the console.
- Every abuse case in the tests returns the right error code.

#### #8 Login UI & session handling (web)

**Labels:** `frontend`, `auth`, `M1` · **Depends on:** #6, #7

**Tasks**

- [ ] `/login`:
  - phone input with a +91 prefix
  - 6-box OTP input (supports paste and SMS autofill)
  - resend timer
  - name step on first login
- [ ] Silent token refresh; auth context; sign-out
- [ ] Route guards: `/vendor/*` needs a vendor role, `/admin/*` needs `super_admin`
- [ ] After login, send each role to its home page (a student goes back to where they started)

**Acceptance criteria**

- Playwright test: login → home page.
- A student who visits `/admin` is redirected and sees "No access".

#### #9 Roles, vendor pre-registration & stall scoping

**Labels:** `backend`, `auth`, `security`, `M1` · **Depends on:** #7

**Tasks**

- [ ] `requireRole()` and `requireStallAccess(stallId)` guards
- [ ] `vendor_invites`: when an invited phone logs in for the first time, create the `stall_members` row and set its role
- [ ] Super-admin bootstrap from the `SUPER_ADMIN_PHONES` environment variable
- [ ] Suspension: refresh is blocked and sessions are revoked
- [ ] Audit-log helper `audit(actor, action, entity, before, after)`
- [ ] **Authorization test matrix** across roles × endpoints, including the cross-stall access tests

**Acceptance criteria**

- Vendor A gets 403 on every stall-B endpoint.
- A pre-registered number lands as `vendor_owner` on its first login.

### M2 — Student ordering

#### #10 Stall status & congestion engine

**Labels:** `backend`, `M2` · **Depends on:** #4, #5

**Tasks**

- [ ] `isOpen(stall, now)` with opening hours (several slots a day, slots that cross midnight), the
      manual override and `accepting_orders`
- [ ] Wait-time estimate and congestion level (§10), with configurable thresholds
- [ ] `GET /stalls`, `GET /stalls/:slug` including status, wait time, level and accepted payment methods
- [ ] pg-boss setup plus a midnight job that resets the overrides
- [ ] Unit tests with a fixed clock (IST)

**Acceptance criteria**

- The tests cover open, closed, paused, a slot that crosses midnight, and all 3 congestion levels.

#### #11 Stalls home page

**Labels:** `frontend`, `M2` · **Depends on:** #6, #10

**Tasks**

- [ ] StallCard list with photo, tags, Open/Closed chip ("Opens 5 PM"), CongestionMeter, wait time and payment icons
- [ ] Sorting: open stalls first, then by wait time. Search by stall or dish, and a veg-only filter
- [ ] Loading skeletons, empty and error states, pull-to-refresh, 30 s polling (SSE comes in #17)
- [ ] Turn on the Playwright job in CI

**Acceptance criteria**

- A closed stall is greyed out with its opening time.
- The meter updates without a page reload.

#### #12 Stall menu page

**Labels:** `frontend`, `backend`, `M2` · **Depends on:** #10

**Tasks**

- [ ] `GET /stalls/:id/menu`: categories → items (only visible items; sold-out items are flagged)
- [ ] The page:
  - stall header
  - sticky category tabs that scroll to each section
  - item rows with photo, veg dot, price and stepper
  - an item detail bottom sheet
- [ ] Image delivery via CloudFront URLs with fixed sizes and lazy loading
- [ ] Closed or paused stall: the menu can be browsed, but "Add" is disabled and a banner explains why

**Acceptance criteria**

- A menu of 50 items scrolls smoothly on a mid-range phone.
- Sold-out items can't be added.

#### #13 Cart

**Labels:** `frontend`, `M2` · **Depends on:** #12

**Tasks**

- [ ] Cart store (one stall), persisted in localStorage, with a "replace cart?" dialog when the stall changes
- [ ] Sticky cart bar; `/cart` page with item editing and a note
- [ ] `POST /cart/quote`: the server re-prices the cart, returns the fee breakdown for each payment
      method and flags items that are unavailable or whose price changed

**Acceptance criteria**

- A price change made by the vendor is shown to the student before payment.
- The cart survives a reload.

#### #14 Checkout & order placement

**Labels:** `backend`, `frontend`, `M2` · **Depends on:** #9, #13 · **Needs:** Q1

**Tasks**

- [ ] `POST /orders` with an `Idempotency-Key`, in one DB transaction:
  - re-price the items
  - check the stall is open and accepting orders, and that the payment method is enabled
  - apply the cash limits and strikes
  - snapshot the fees
  - create the order and its items
  - for **cash**: issue the token and pickup code immediately; for **UPI**: create a `pending_payment` order
- [ ] Token issue with `SELECT … FOR UPDATE` on `token_counters` (IST day)
- [ ] Checkout UI: UPI/Cash selector (only the enabled methods), live bill breakdown, place order
- [ ] Ledger entries are written when the order is confirmed
- [ ] Concurrency test: 50 parallel orders → tokens 1…50 with no gaps or duplicates

**Acceptance criteria**

- A cash order returns a token at once.
- A repeated request with the same key returns the same order.
- The fees match `calcFees`.

#### #15 Razorpay UPI payments

**Labels:** `backend`, `frontend`, `payments`, `M2` · **Depends on:** #14 · **Needs:** Q5 (test keys)

**Tasks**

- [ ] Create a Razorpay order for each UPI order; Checkout on the web with UPI shown first; prefill the phone number
- [ ] `POST /payments/razorpay/verify` (HMAC) → idempotent `confirmPayment()`: token, `placed`, ledger entries
- [ ] `POST /webhooks/razorpay` (signature check, de-duplicated by event ID) using the same confirm path
- [ ] Failed or closed checkout → the "Retry payment" state
- [ ] A pg-boss job that expires `pending_payment` orders after 15 min
- [ ] Refund service (used by reject, cancel and admin refunds)
- [ ] Docs: test UPI IDs and the local webhook tunnel

**Acceptance criteria**

- In Razorpay test mode, `success@razorpay` produces a token.
- Closing the browser after paying still produces a token, via the webhook.
- A duplicate webhook doesn't change anything.

#### #16 Token, QR code & order confirmation screen

**Labels:** `frontend`, `backend`, `M2` · **Depends on:** #14

**Tasks**

- [ ] Signed QR payload `MOM1.<orderId>.<hmac>` (§5); `GET /orders/:id` returns the payload and the pickup code
- [ ] Confirmation screen: big token, QR code, pickup code, stall and location, status stepper,
      "add to home screen" hint
- [ ] Screen wake lock while the QR code is shown (where supported)

**Acceptance criteria**

- The QR code can be scanned from a phone screen at 30 cm.
- A tampered payload fails verification (unit test).

#### #17 My Orders with live status (SSE)

**Labels:** `frontend`, `backend`, `realtime`, `M2` · **Depends on:** #16

**Tasks**

- [ ] SSE infrastructure: Postgres `LISTEN/NOTIFY` → per-user and per-stall channels, a 25 s heartbeat,
      reconnect with `Last-Event-ID`, ALB idle timeout tuning
- [ ] `/orders`: active orders (live) and history (paginated); order detail and receipt; Reorder;
      cancel (allowed only before `preparing`)
- [ ] Ready state: full-screen green, a sound or vibration, and the page title flashing "Ready!"

**Acceptance criteria**

- The vendor marks an order ready and the student's screen updates within 2 s.
- The page recovers after the network drops.

### M3 — Stall console

#### #18 Vendor live order board

**Labels:** `frontend`, `backend`, `vendor`, `M3` · **Depends on:** #9, #17

**Tasks**

- [ ] `GET /vendor/stalls/:id/orders?day=today` + SSE stream for that stall
- [ ] Board: New / Preparing / Ready columns (tabs on phones). Cards show the token, items, note,
      payment badge (UPI paid / Cash due ₹X) and elapsed time
- [ ] Actions:
  - Accept → `preparing`
  - Reject (with a reason) → automatic refund for UPI orders
  - Mark ready
- [ ] A chime for new orders (with an unlock-audio button) and a badge in the tab title
- [ ] Status transitions enforced on the server, with audit entries

**Acceptance criteria**

- A new order appears within 2 s with a sound.
- Rejecting a UPI order triggers a test-mode refund.

#### #19 Menu management (CRUD) with image upload

**Labels:** `frontend`, `backend`, `vendor`, `M3` · **Depends on:** #9, #12

**Tasks**

- [ ] CRUD endpoints for categories and items (soft delete), reordering, bulk availability
- [ ] `POST /vendor/uploads/presign` (S3 presigned PUT, ≤ 2 MB, image types only); compress in
      the browser to WebP ≤ 1200 px; preview; replace or remove
- [ ] Vendor UI: category list, item form (name, description, price in ₹, veg, image, available),
      an availability toggle on each row
- [ ] Audit price changes

**Acceptance criteria**

- An item created with a photo appears on the student menu.
- Vendor A can't upload to stall B's image path.

#### #20 Stall settings, hours & payment methods

**Labels:** `frontend`, `backend`, `vendor`, `M3` · **Depends on:** #10, #15

**Tasks**

- [ ] Open now / Close now / Follow hours; pause new orders
- [ ] Weekly opening-hours editor (several slots a day)
- [ ] Prep time and parallel capacity (they feed the meter); stall photo and description
- [ ] **Payment methods:** UPI and Cash toggles. UPI needs `route_status = activated`; until then,
      show "Settlement account pending" (onboarding happens in #23/#26)

**Acceptance criteria**

- Turning cash off hides it at checkout immediately.
- Hours changes update the open/closed chip.

#### #21 Pickup verification: QR scanner & token entry

**Labels:** `frontend`, `backend`, `vendor`, `M3` · **Depends on:** #16, #18

**Tasks**

- [ ] `POST /vendor/pickup/verify` (QR payload, or token + pickup code), with the checks from §5
- [ ] Camera scanner (native `BarcodeDetector` with a JS fallback library), torch toggle, beep and vibrate
- [ ] Manual entry: token number + 4-digit code keypad
- [ ] Result card: ✅ order details / ❌ reason (wrong stall, already collected, not paid, unknown)
- [ ] "Hand over" → `collected`; for cash orders, "Cash received ₹X" → `paid_cash` plus ledger entries
- [ ] Release the Route transfer hold on collection (once #26 is done)

**Acceptance criteria**

- Scanning a valid QR code hands the order over in under 3 taps.
- Scanning it a second time shows "Already collected".
- Another stall's QR code is rejected.

#### #22 Vendor sales & dues report

**Labels:** `frontend`, `backend`, `vendor`, `M3` · **Depends on:** #21

**Tasks**

- [ ] `GET /vendor/stalls/:id/reports?from&to`: orders, gross sales, UPI vs cash, fees owed (cash),
      transfers received, net balance — all from the ledger
- [ ] Today / week / month views, simple charts, CSV export
- [ ] Daily summary of the day's sales

**Acceptance criteria**

- The report totals equal the sum of the ledger entries for the period (integration test).

### M4 — Super admin

#### #23 Admin: stalls & vendor onboarding

**Labels:** `frontend`, `backend`, `admin`, `M4` · **Depends on:** #9, #19

**Tasks**

- [ ] Admin layout and navigation
- [ ] Stalls list and detail; create, edit and suspend stalls; edit the menu on the stall's behalf (audited)
- [ ] **Register the owner's phone** → `vendor_invites` (with an optional SMS invite later)
- [ ] Razorpay Route: create the linked account (owner details, bank or UPI) and show its status
- [ ] Stall go-live checklist: menu ✔ hours ✔ photo ✔ payment methods ✔

**Acceptance criteria**

- An admin creates a stall and registers a phone, and that phone logs in to the stall's console.

#### #24 Admin: users, roles & access control

**Labels:** `frontend`, `backend`, `admin`, `security`, `M4` · **Depends on:** #23

**Tasks**

- [ ] Users table: search by phone or name, filter by role or status
- [ ] User detail: their orders, cash strikes (reset), role change, suspend or reactivate, force sign-out
- [ ] Manage super admins (needs a confirmation step and at least 1 super admin must always remain)
- [ ] Orders explorer: filters, timeline, admin cancel/refund with a reason

**Acceptance criteria**

- Suspending a user signs them out within 15 min.
- Every action appears in the audit log.

#### #25 Commission ledger & revenue dashboard

**Labels:** `frontend`, `backend`, `admin`, `finance`, `M4` · **Depends on:** #21

**Tasks**

- [ ] Ledger service (append-only) with entries for: confirm, cash collected, refund, adjustment
- [ ] `/admin/overview`: today's KPIs, live orders, failed payments
- [ ] `/admin/revenue`: by day, week or month; per-vendor commission (platform fee vs cash fee);
      UPI/cash mix; top stalls; charts and CSV
- [ ] Nightly reconciliation job (ledger vs orders vs Razorpay payments) with an alert on mismatch

**Acceptance criteria**

- Dashboard numbers match a hand-computed seed scenario.
- The reconciliation job flags a deliberately broken order.

#### #26 Settlements: Route transfers & cash dues

**Labels:** `backend`, `admin`, `payments`, `finance`, `M4` · **Depends on:** #15, #25 · **Needs:** Q5 (Route enabled)

**Tasks**

- [ ] On UPI confirmation: create a Route transfer of `subtotal` to the stall (held); release it on `collected`; reverse it on refund
- [ ] Net cash receivables against transfers (configurable), or record manual cash settlements
- [ ] `/admin/settlements`: balance per stall, history, weekly statement (PDF/CSV)
- [ ] Transfer webhooks and retries

**Acceptance criteria**

- In test mode, an order handed over releases its transfer.
- A stall's statement balances to ₹0.00 after settlement.

#### #27 Platform settings, feature flags & audit log viewer

**Labels:** `frontend`, `backend`, `admin`, `M4` · **Depends on:** #24

**Tasks**

- [ ] Versioned fee settings with an effective-from time (new orders only) and a preview of the fee on ₹100
- [ ] Settings: cash-order limits, strike limit, order expiry, congestion thresholds, global flags
      (cash on/off, ordering paused)
- [ ] Audit log viewer: filter by actor, entity and date; before/after diff

**Acceptance criteria**

- Changing the fee affects only new orders.
- Every setting change is audited.

### M5 — Deployment & launch (AWS)

#### #28 AWS staging environment + continuous deployment

**Labels:** `infra`, `M5` · **Depends on:** all development issues (#1–#27) · **Needs:** Q3, Q4, Q5 (test keys)

**Tasks**

- [ ] CDK app in `infra/`:
  - VPC
  - RDS Postgres (staging size)
  - ECR, ECS Fargate service + ALB + ACM certificate
  - S3 images bucket + CloudFront (OAC)
  - Secrets Manager
  - CloudWatch log groups
  - Budgets alerts
- [ ] Amplify Hosting app for `apps/web`, connected to GitHub, with PR previews (if Amplify
      doesn't support our Next.js version, use a container on ECS behind CloudFront instead)
- [ ] GitHub OIDC role; a deploy workflow on merge to `main` (build image → migrate → deploy ECS)
- [ ] Domains: `staging.<domain>` and `api.staging.<domain>`
- [ ] Switch the local adapters to the AWS ones: MinIO → S3 + CloudFront, console SMS → AWS End User Messaging SMS (test numbers until DLT is approved)
- [ ] Point the Razorpay test webhook at the staging API; seed staging data
- [ ] `docs/infra.md` runbook (deploy, roll back, view logs)

**Acceptance criteria**

- Merging a PR deploys automatically.
- `https://api.staging.<domain>/ready` returns 200.
- The web app loads from Amplify.

#### #29 Production environment & hardening

**Labels:** `infra`, `security`, `M5` · **Depends on:** #28, #27 · **Needs:** Q4, Q5 (live keys), Q6 (DLT)

**Tasks**

- [ ] CDK `prod` stage:
  - RDS Multi-AZ with PITR (7–14 days) and deletion protection
  - 2+ Fargate tasks with autoscaling
  - WAF (managed rules + rate limits)
- [ ] CloudWatch alarms: 5xx rate, p95 latency, RDS CPU/storage/connections, failed jobs, payment
      webhook failures → email/SMS
- [ ] Release workflow: tag `v*` → manual approval → deploy to prod; documented rollback
- [ ] Production secrets (live Razorpay keys, SMS DLT IDs, JWT and QR secrets), rotation notes
- [ ] Backup restore drill (restore a snapshot to a temporary instance)
- [ ] AWS Budgets and a cost review in April 2027

**Acceptance criteria**

- Prod is reachable at `https://<domain>`.
- The restore drill is documented.
- A test alarm reaches your phone.

#### #30 QA, legal pages & go-live

**Labels:** `qa`, `launch`, `M5` · **Depends on:** #29

**Tasks**

- [ ] Playwright end-to-end tests:
  - student UPI order → vendor accept → ready → scan → collected
  - the cash path
  - reject → refund
  - admin revenue
- [ ] Load test (k6): 200 concurrent students during the lunch rush; p95 under 500 ms; no duplicate tokens
- [ ] Security pass: OWASP checklist, dependency audit, authorization matrix re-run
- [ ] Legal pages: Terms, Privacy (DPDP), Refund & Cancellation, Contact; footer links (Razorpay needs these)
- [ ] Pilot with 3–5 stalls (Q9): onboarding guide for owners (Odia/English one-pager), a counter QR standee
- [ ] Launch checklist and an on-call note for the first week

**Acceptance criteria**

- All end-to-end tests pass against staging.
- Pilot stalls take real orders in prod.
- No P1 bugs open.

---

## 16. After v1 (next backlog)

- Expo mobile app (student first, then vendor scanner) on the same `/v1` API
- Web Push and SMS notifications when an order is ready
- Learned prep times; peak-hour surge controls
- Ratings and reviews; favourites; coupons and offers
- Staff accounts for vendors (`vendor_staff` UI)
- Multi-campus support
