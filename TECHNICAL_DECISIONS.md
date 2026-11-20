# Technical decisions

## Monorepo

npm workspaces. Shared Zod schemas live in `@marketplace/shared` and are built to `dist` before the API or web imports them. The API package exports map includes `import`, `require`, and `default` so `tsx` can load the seed.

## Money

Prices are Prisma `Decimal` in the database and integer cents in `quoteCart`. Commission is `round(cents * basisPoints / 10000)`. Priority is store rate, then category rate, then the platform default (10%). Vendor earnings are merchandise after discount, minus commission, plus that studio’s shipping share. Tax stays with the platform. A $100 line at 10% is $10 platform and $90 vendor before shipping.

## Checkout

One transaction creates the parent order, vendor suborders, per-line commissions, inventory reservations (`quantity - reserved`), coupon usage, and a pending payment, then clears the cart. The ledger (gross, commission, shipping) posts only after payment succeeds. Payouts are a separate record and become a negative ledger entry only when marked paid.

Shipping is $6.50 standard, free at $75 merchandise after discount, or $14 express. A free-shipping coupon zeroes the selected method. Tax is the configured percent of merchandise after discount.

## Auth

`bcryptjs` cost 12, chosen so install does not need native `bcrypt`. Access tokens last 15 minutes and are returned in JSON. Refresh tokens are httpOnly cookies on `/api/v1/auth`, stored hashed, and rotated. The Vite proxy keeps that cookie on the web origin in development. Nginx in the web image proxies `/api` and `/uploads` for the same reason in Compose.

`require_verified_email` defaults to false so checkout works before the mailbox is opened. Unverified shoppers see a note on the account page.

## Search and cache

`SearchEngine` is chosen at startup. Postgres uses `plainto_tsquery` plus `ILIKE`. If Elasticsearch is configured and a query fails, that request uses Postgres. Suggestions stay on Postgres.

Redis is optional. `lazyConnect` plus `enableOfflineQueue: false` dropped the first command, so the client connects before get, set, and delete. If Redis is down, cache calls no-op and health reports `down`.

## Payments and files

`PaymentProvider` is mock or Stripe. Stripe uses `fetch` for PaymentIntents, `transfer_group`, and Transfers. The mock confirm endpoint accepts `{ outcome: "success" | "failure" }` and never a card number. Webhooks check HMAC.

Uploads check magic bytes, allow jpeg/png/webp/gif, and cap size at 5MB. Files go to `apps/api/uploads` unless `STORAGE_DRIVER=s3`.

## Tests

Vitest sets `DATABASE_URL` to `marketplace_test` before dotenv so a developer `.env` cannot point tests at the dev database.
