# API

Base path: `/api/v1`. Interactive docs: `/api/docs`.

Send `Authorization: Bearer <access>` for signed-in calls and `X-Session-Id` for a guest cart or wishlist. Refresh uses the `refresh_token` cookie and `POST /auth/refresh`.

## Auth

`POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`, `GET/PATCH /auth/me`, `POST /auth/change-password`.

## Shop

`GET /health`, `/catalog/home`, `/categories`, `/brands`, `/products`, `/products/:slug`, `/search/suggest`, `/stores`, `/stores/:slug`, `/shipping/methods`.

Cart: `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id`, `PUT /cart/coupon`.

Checkout: `POST /checkout/quote`, `POST /checkout` with header `Idempotency-Key`, `POST /payments/:id/confirm` body `{ "outcome": "success" | "failure" }`.

Orders, wishlist, reviews, addresses, notifications, `POST /newsletter`, `POST /support`.

## Vendor

Prefix `/vendor`. Requires role `VENDOR` and, for studio data, an approved store.

Overview, analytics, products, inventory adjustments, orders and `POST /orders/:id/status`, customers, coupons, reviews, store settings, earnings, payouts, profile, `GET /application`.

## Admin

Prefix `/admin`. Requires role `ADMIN`.

Overview, analytics, sales report (`?format=csv`), users, vendors (approve, reject, suspend, commission), applications, products, categories, orders, payments, transactions, commissions, payouts, refunds, coupons, reviews, search reindex, settings, audit.

## Uploads and mail

`POST /uploads` accepts one image for vendors and admins. Outside production, `GET /dev/mailbox` lists stored mail.
