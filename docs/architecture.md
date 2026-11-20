# Architecture

Northstar is a modular monolith. One Express process owns commerce rules. The React app is a client of `/api/v1`.

```text
apps/web  ->  Vite proxy /api  ->  apps/api  ->  PostgreSQL
                                      |  -> Redis (cache, optional)
                                      |  -> Elasticsearch (search, optional)
                                      -> local disk or S3 for images
```

## Request path

Routes live in `apps/api/src/routes`. Domain rules live in `apps/api/src/domain`. Middleware authenticates the bearer token, reads `X-Session-Id` for guest carts, and enforces roles. Successful JSON is `{ success, message, data, meta }`. Errors are `{ success: false, message, errors }`.

## Commerce

Checkout quotes from current prices and stock. The browser never sends a price. One database transaction writes the customer order, one vendor order per studio, commissions, reservations, and a pending payment. Confirming payment posts the vendor ledger. Cancelling an unpaid order releases reservations. A full vendor refund restocks and reverses commission. Partial refunds are proportional and do not restock.

## Identity

Customers, vendors, and admins share the user table. Vendors have a profile, an application, and, once approved, a store. Pending vendors can sign in and see application status. Studio and admin routes return 403 for the wrong role.

## Front end

Routes are in `apps/web/src/App.tsx`. Server state uses TanStack Query. The session store holds the access token, user, guest session id, and toasts. The app waits for the refresh cookie before the first queries so a reload does not read a guest cart over a signed-in cart.

## Search

Product list filters (text, category, vendor, brand, price, rating, stock, sort, page) go through one search module. The response `meta.engine` says `postgresql` or `elasticsearch`.
