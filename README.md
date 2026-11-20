# Northstar

Northstar is a multi-vendor marketplace. Customers buy from more than one studio in a single checkout. Each studio fulfills its own suborder. The platform records commission, vendor earnings, and payouts separately from the customer payment.

## Features

- Customer shop: home, search, filters, product pages, stores, cart, checkout, mock or Stripe payment, orders, tracking, wishlist, reviews, addresses
- Vendor studio: application, approval, catalog, inventory, suborders, shipping, coupons, earnings, payouts, analytics
- Admin: users, vendors, products, orders, refunds, commissions, payouts, coupons, reviews, settings, audit log
- Auth with access JWTs, rotating refresh cookies, and role checks on the API
- Money stored as decimals and calculated in integer cents
- PostgreSQL full-text search, with optional Elasticsearch
- Redis cache when Redis is reachable; the shop still runs without it

## Stack

React, TypeScript, Vite, Tailwind, React Router, TanStack Query, Zustand, React Hook Form, Zod, Express, Prisma, PostgreSQL, Redis, Docker Compose.

## Architecture

The monorepo has three workspaces:

- `apps/web` — storefront and dashboards
- `apps/api` — `/api/v1` REST API
- `packages/shared` — roles, order statuses, and Zod schemas

Postgres is the source of truth. The cart is stored in Postgres. Redis caches the homepage. Search uses Postgres unless `ELASTICSEARCH_URL` is set and reachable. Payments go through a provider interface. With no Stripe secret, checkout uses the mock provider. Card numbers are validated in the browser and are not sent to the API.

See `docs/architecture.md`, `docs/api.md`, `docs/database.md`, and `docs/deployment.md`.

## Prerequisites

- Node.js 20 or newer
- PostgreSQL 16
- Redis 7, optional but used for cache when `REDIS_URL` is set
- Docker, optional, for the Compose stack

## Install

```bash
cd marketplace
cp .env.example .env
# Put long random values in JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, and MOCK_WEBHOOK_SECRET.
npm install
npm run build -w @marketplace/shared
npm run db:migrate
npm run db:seed
```

Create the database first if you are not using Docker:

```bash
# example local role
# createuser marketplace --pwprompt
# createdb -O marketplace marketplace
```

The seed expects `DATABASE_URL` to point at the development database, not the test database.

## Run

```bash
npm run dev
```

- Web: http://127.0.0.1:5173
- API: http://127.0.0.1:4000
- OpenAPI: http://127.0.0.1:4000/api/docs
- Dev mailbox: http://127.0.0.1:4000/api/v1/dev/mailbox

The Vite dev server proxies `/api` and `/uploads` to the API so the refresh cookie stays on the web origin.

Docker Compose (not executed in the environment that built this tree, because Docker was not installed there):

```bash
docker compose up --build
```

Add `--profile search` to start Elasticsearch.

## Demo accounts

Local seed only. Change these before any shared deployment.

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@northstar.market | NorthstarAdmin!24 |
| Vendor, Atelier Maya | maya.chen@atelier.market | VendorPass!24 |
| Vendor, Field & Co. (8% commission) | leo.hart@fieldandco.market | VendorPass!24 |
| Vendor, Harbor Home | nora.ellis@harborhome.market | VendorPass!24 |
| Pending vendor | sam.okafor@pending.market | VendorPass!24 |
| Customer | jordan.lee@example.com | CustomerPass!24 |

Other seeded customers use `CustomerPass!24`.

## Tests

```bash
npm test
npm run test:e2e -w @marketplace/web
```

API tests use `marketplace_test` and do not touch the development database. Start the web and API before Playwright. The browser journey registers a customer, searches, filters, checks out products from two studios, pays with the mock card form, and checks vendor isolation, shipping, admin commission, and a review.

## Screenshots

The shop was exercised in Chromium against the seeded API. A captured frame of the homepage is in `docs/screenshots/home.png` when that file has been generated on a machine with the dev servers running.

## Limitations

- Stripe Connect transfers run only when `STRIPE_SECRET_KEY` is set and the store has a connected account id. Local runs use mock payment and mock payouts.
- Elasticsearch is off unless `ELASTICSEARCH_URL` answers. Search then uses Postgres.
- The vendor product form edits the variants it loaded. It does not offer a full attribute matrix builder.
- Docker Compose is defined and was not booted in the build environment.
- Production email needs SMTP. Development mail is stored and listed at `/api/v1/dev/mailbox`.
