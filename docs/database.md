# Database

PostgreSQL and Prisma. Schema: `prisma/schema.prisma`. Migration: `prisma/migrations/20261120143916_init`.

Money columns are `Decimal`. Inventory quantity and reserved quantity are integers. Orders, payments, and ledger rows are written in transactions.

## Main models

User, CustomerProfile, VendorProfile, VendorApplication, Store, Address, Category, Brand, Product, ProductImage, ProductVariant, ProductAttribute, ProductAttributeValue, Inventory, InventoryMovement, Cart, CartItem, Wishlist, WishlistItem, CustomerOrder, VendorOrder, OrderItem, OrderEvent, Payment, PaymentTransaction, PaymentWebhookEvent, Refund, Commission, VendorLedger, Payout, Shipment, Coupon, CouponUsage, Review, Notification, PlatformSetting, AuditLog, NewsletterSubscriber, SupportMessage, DevEmail.

## Seeds

`npm run db:seed` truncates public tables except `_prisma_migrations`, then loads settings, accounts, 9 categories, 48 products, coupons, orders, reviews, a wishlist, and sample payouts. It imports the API domain so totals match checkout.

Tests call `prisma db push` against `marketplace_test` from the Vitest global setup. Do not point `DATABASE_URL` at the test database when seeding.
