# Project progress

Northstar is implemented as a monorepo at the repository root and can be run locally with `npm run dev` after Postgres, Redis, migrations, and seed.

## Verified

- API typecheck, web typecheck
- API Vitest: pricing, auth, RBAC, expired coupon, two-vendor checkout, commission, vendor isolation, shipment, refund with restock, oversell (8 tests)
- Web Vitest: listing query builder and login form validation (3 tests)
- Playwright Chromium: register, search, category filter, two-vendor cart, mock payment, parent order, vendor A/B isolation, independent shipping update, admin parent order, commission and earnings (`$6.40` / `$57.60` and `$2.24` / `$25.76` on a $64 tote at 10% and a $28 mug at the studio’s 8%), and a verified-purchase review
- `GET /api/v1/health` with Postgres up, Redis up, search engine `postgresql`
- Seed: 48 live products, 9 categories, 3 approved studios, 1 pending application, 12 customers, orders, reviews, coupons, and payouts
- Demo logins for admin, vendor, and customer

## Not verified here

- `docker compose up` — Docker is not installed in the environment that built this tree. The Compose file, Dockerfiles, and nginx proxy are in the repo.
- A live Stripe account. The Stripe provider is implemented with `fetch` and is selected only when `STRIPE_SECRET_KEY` is set.
- Elasticsearch. The client falls back per request when the URL is missing or the cluster errors.

## Phase status

1. Architecture and planning — done, recorded in `TECHNICAL_DECISIONS.md` and `docs/`
2. Foundation — done. Both apps start.
3. Auth and seed accounts — done and tested
4. Marketplace pages and search — done. Postgres search verified with `q=merino`
5. Vendor tools — done against the API. The studio UI covers the spec nav. Pending vendors see the application state instead of the studio.
6. Cart, checkout, mock payment, commissions, ledger — done and tested
7. Orders, shipments, refunds — done. Customer tracking, vendor status steps, and admin refund are wired. Playwright shipped one suborder.
8. Admin — done. Dashboard and management pages call the admin API.
9. Search fallback, notifications, reviews, wishlist, analytics, storage, Stripe architecture — done in code. Elasticsearch and S3 were not exercised with live services.
10. Tests — API, web unit, and the Playwright journey above pass. Not every screen has a browser assertion.
11. Docs and deployment configuration — done. Compose was not executed here.

## Known limitations

- Vendor product editing preserves loaded variants and images, but it is not a matrix builder for new option combinations.
- Guest carts merge when the session id is sent with login or register. A full reload waits for the refresh cookie before the shop queries, so the signed-in cart is the one displayed.
- Payout email from `setPayoutStatus` is stored as an in-app notification. The returned email is not sent by that function.
- A webhook event is stored before processing. A failed confirm is not retried for the same event id.
- No GIN index migration yet. Postgres search still uses `to_tsvector` in the query.
- Rate limits are on. Tests disable them with `VITEST`.
