export const openApi = {
  openapi: "3.0.3",
  info: {
    title: "Northstar Marketplace API",
    version: "1.0.0",
    description: "Versioned REST API for the Northstar multi-vendor marketplace. Money is decimal strings. The server prices every cart and order.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Envelope: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          message: { type: "string" },
          data: {},
          meta: { type: "object" },
        },
      },
    },
  },
  paths: {
    "/health": { get: { summary: "Service health", responses: { "200": { description: "Database, Redis, and search status" } } } },
    "/auth/register": { post: { summary: "Register a customer or vendor", responses: { "200": { description: "Access token. Refresh token is an httpOnly cookie." } } } },
    "/auth/login": { post: { summary: "Sign in", responses: { "200": { description: "Access token" } } } },
    "/auth/refresh": { post: { summary: "Rotate the refresh cookie", responses: { "200": { description: "New access token" } } } },
    "/auth/logout": { post: { summary: "Revoke the refresh cookie", responses: { "200": { description: "Signed out" } } } },
    "/catalog/home": { get: { summary: "Homepage collections", responses: { "200": { description: "Categories, products, vendors, banners" } } } },
    "/products": { get: { summary: "Search and filter products", responses: { "200": { description: "Paged product cards. Uses Elasticsearch when configured, otherwise PostgreSQL." } } } },
    "/products/{slug}": { get: { summary: "Product detail", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Product, variants, reviews" } } } },
    "/cart": { get: { summary: "Current cart priced by the server", responses: { "200": { description: "Cart and quote" } } } },
    "/checkout": {
      post: {
        summary: "Place a multi-vendor order",
        security: [{ bearerAuth: [] }],
        description: "Creates the parent order, vendor suborders, commission rows, and an inventory reservation in one transaction.",
        responses: { "200": { description: "Order awaiting payment" } },
      },
    },
    "/payments/{id}/confirm": {
      post: {
        summary: "Confirm a mock or Stripe payment",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Paid order or a failed payment with stock released" } },
      },
    },
    "/payments/webhook": { post: { summary: "Payment provider webhook", responses: { "200": { description: "Accepted" } } } },
    "/orders/{orderNumber}": { get: { summary: "Customer or admin order detail", security: [{ bearerAuth: [] }], responses: { "200": { description: "Parent order and vendor suborders" } } } },
    "/vendor/orders": { get: { summary: "Vendor suborders only", security: [{ bearerAuth: [] }], responses: { "200": { description: "Orders for the signed-in store" } } } },
    "/admin/overview": { get: { summary: "Admin metrics from live aggregates", security: [{ bearerAuth: [] }], responses: { "200": { description: "GMV, commission, orders, charts" } } } },
  },
};
