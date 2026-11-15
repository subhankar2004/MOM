# MOM — campus food-stall ordering

Students around VSSUT pick a food stall, browse its menu, order, and pay
**online (+1% convenience fee)** or **at the counter (+5% charge)**. They get a
**token number** and collect the food at the stall when it's ready. Stall owners
see orders live on a dashboard; the MOM team runs everything from an admin page.

```
MOM/
├── supabase/   Postgres schema, business logic, RLS, Razorpay Edge Functions
├── web/        Next.js 16 — student site (PWA) + stall dashboard + admin + /pay page
└── mobile/     Expo (SDK 58) — student app for Android/iOS
```

## How it works

| Step | What happens | Where |
|---|---|---|
| Browse | Stalls and menus are public | `stalls`, `menu_items` tables |
| Order | `place_order()` re-prices every item from the DB, adds the fee (online 1% / offline 5%) and creates the order | `supabase/migrations/*_init.sql` |
| Pay at counter | Token issued immediately; status `placed`, payment `pay_at_counter` | same |
| Pay online | Status `pending_payment` → `create-payment` makes a Razorpay order → Checkout → `verify-payment` checks the HMAC signature → `confirm_online_payment()` issues the token | `supabase/functions/*` |
| Backup | Razorpay webhook confirms the payment even if the student closed the app | `razorpay-webhook` |
| Kitchen | Stall moves orders: New → Preparing → Ready → Handed over (realtime + chime) | `web/src/app/vendor` |
| Pickup | Student's screen turns green with the token; offline orders become `paid` on hand-over | `orders/[id]` |

Token numbers restart at **#1 every day per stall** (India time) and are issued
under a row lock, so two students never get the same token.

Money is stored as **integer paise** (₹136.50 = `13650`). Fee = `round(subtotal × % / 100)`.
Fee percentages live in the `platform_settings` table and can be changed from **/admin**
without a deploy.

## Local development (Docker)

The whole backend runs locally in Docker with its own volumes
(`supabase_db_mom`, `supabase_storage_mom`, `supabase_edge_runtime_mom`):

```bash
npm install          # once — installs the pinned Supabase CLI
npm run db:start     # Postgres + auth + REST + realtime + Edge Functions; applies migrations + seed
npm run web          # http://localhost:3000
npm run mobile       # Expo
npm run db:stop      # stop (data kept)   ·   npm run db:reset  wipes & rebuilds
```

Studio: <http://127.0.0.1:54323> · local email inbox (login codes): <http://127.0.0.1:54324>.
Login emails use `supabase/templates/login_code.html` (6-digit `{{ .Token }}`).
For local Razorpay testing, copy `supabase/functions/.env.example` → `.env`.
See **quick_start.txt** for a beginner walkthrough.

## Cloud setup (≈20 minutes)

### 1. Supabase
1. Create a free project at <https://supabase.com>.
2. Link and push the schema + demo data:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push            # runs supabase/migrations
   # demo stalls/menus: paste supabase/seed.sql into Dashboard → SQL Editor and run it
   ```
3. **Email OTP:** Dashboard → Authentication → Email Templates → paste
   `supabase/templates/login_code.html` into both *Magic Link* and *Confirm signup*
   (it shows the 6-digit `{{ .Token }}`).
   For real traffic, set up custom SMTP (the built-in sender is rate-limited).
4. **Realtime** is enabled for `orders` by the migration (check Database → Publications if not).

### 2. Razorpay (test mode first)
1. Sign up at <https://dashboard.razorpay.com>, stay in **Test Mode**, create API keys.
2. Set the secrets and deploy the functions:
   ```bash
   npx supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx RAZORPAY_WEBHOOK_SECRET=choose-a-secret
   npx supabase functions deploy create-payment
   npx supabase functions deploy verify-payment --no-verify-jwt
   npx supabase functions deploy razorpay-webhook --no-verify-jwt
   ```
3. Razorpay Dashboard → Webhooks → add
   `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook`
   with events `payment.captured` and `order.paid`, and the same webhook secret.

### 3. Web app
```bash
cd web
cp .env.example .env.local      # fill in Supabase URL + anon/publishable key
npm install
npm run dev                     # http://localhost:3000
```
Deploy to Vercel (root directory `web`, same env vars). Then in Supabase →
Authentication → URL Configuration, set the Site URL to your Vercel URL.

### 4. Mobile app
```bash
cd mobile
cp .env.example .env.local      # Supabase URL/key + EXPO_PUBLIC_WEB_URL (your deployed web app)
npm install
npx expo start                  # scan the QR with Expo Go
```
Online payment in the app opens the web app's `/pay` page in an in-app browser and
returns via the `mom://` deep link, so it works in **Expo Go** — no native Razorpay
SDK needed. Build store binaries with `npx eas-cli@latest build`.

### 5. Make yourself admin and onboard a stall
1. Sign in once on the web app with your email.
2. Supabase → SQL Editor:
   ```sql
   update profiles set role = 'admin' where email = 'you@example.com';
   ```
3. Go to **/admin** → create a stall (or use the seeded ones) → ask the stall owner to
   sign in once, then **Link owner** with their email. They now see **My stall**
   (live orders + menu editor) on the web app — a tablet or phone at the counter works well.

## Testing payments
Razorpay test mode: UPI `success@razorpay`, or card `4111 1111 1111 1111`, any future
expiry, any CVV. Watch the order flip from *Awaiting payment* to a token number.

## Before going live
- **Razorpay KYC / live keys** — needs a business entity or sole-proprietor docs and a bank account.
- **Paying the stalls:** online money lands in MOM's Razorpay account. Start with
  manual daily settlements (the stall dashboard shows the day's sales). Next step:
  [Razorpay Route](https://razorpay.com/route/) to split each payment automatically
  (stall gets food value, MOM keeps the 1%).
- **Refunds:** when a stall cancels a paid online order it is marked `refunded` —
  issue the actual refund from the Razorpay dashboard (automate via the Refunds API later).
- **Abandoned online orders** stay `pending_payment`; add a scheduled job to cancel ones older than ~30 min.
- Fee wording/legal: show fees before payment (done in the cart) and publish terms + refund policy pages (Razorpay requires them).

## Roadmap ideas
Push notifications when food is ready (Expo Notifications) · stall photos via Supabase Storage ·
ratings · estimated wait time from the queue length · phone OTP login · combo offers ·
analytics per stall · vendor Android app.
