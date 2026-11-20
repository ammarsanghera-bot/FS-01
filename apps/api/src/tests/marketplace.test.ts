import { hashPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";
import { saveSettings, SETTING_DEFAULTS } from "../domain/settings.js";
import { createApp } from "../app.js";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

const app = createApp();
const address = { fullName: "Jordan Lee", line1: "18 Pearl Street", city: "Portland", state: "OR", postalCode: "97214", country: "US" };

let adminToken = "";
let mayaToken = "";
let leoToken = "";
let jordanToken = "";
let categoryId = "";
let mayaVariant = "";
let leoVariant = "";
let scarceVariant = "";

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations') LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);
  await saveSettings({ ...SETTING_DEFAULTS, vendor_approval_required: false, product_approval_required: false, review_moderation_required: false, tax_rate: 8, default_commission_rate: 10, free_shipping_threshold: 75, standard_shipping: 6.5 });
  await prisma.user.create({
    data: { email: "admin@northstar.market", passwordHash: await hashPassword("NorthstarAdmin!24"), role: "ADMIN", firstName: "Amina", lastName: "Shah", emailVerifiedAt: new Date() },
  });
  const category = await prisma.category.create({ data: { name: "Apparel", slug: "apparel", description: "Clothing and layers." } });
  categoryId = category.id;
  adminToken = await login("admin@northstar.market", "NorthstarAdmin!24");
  mayaToken = (await registerVendor("maya@test.market", "Atelier Maya")).token;
  leoToken = (await registerVendor("leo@test.market", "Field and Co")).token;
  const field = await prisma.store.findFirstOrThrow({ where: { name: "Field and Co" } });
  await prisma.store.update({ where: { id: field.id }, data: { commissionRate: "8.00" } });
  mayaVariant = await createProduct(mayaToken, { name: "Merino Crew", sku: "A-TEE", price: "50.00", quantity: 20 });
  leoVariant = await createProduct(leoToken, { name: "Field Skillet", sku: "B-PAN", price: "25.00", quantity: 20 });
  scarceVariant = await createProduct(mayaToken, { name: "Last Beanie", sku: "A-HAT", price: "40.00", quantity: 1 });
  jordanToken = (await registerCustomer("jordan@test.market")).token;
});

describe("auth and authorization", () => {
  it("rejects a bad password and blocks customers from admin routes", async () => {
    const bad = await request(app).post("/api/v1/auth/login").send({ email: "jordan@test.market", password: "nope" });
    expect(bad.status).toBe(401);
    const forbidden = await request(app).get("/api/v1/admin/overview").set("authorization", `Bearer ${jordanToken}`);
    expect(forbidden.status).toBe(403);
    const admin = await request(app).get("/api/v1/admin/overview").set("authorization", `Bearer ${adminToken}`);
    expect(admin.status).toBe(200);
    expect(admin.body.success).toBe(true);
  });

  it("stops a vendor from editing another store's product", async () => {
    const products = await request(app).get("/api/v1/vendor/products").set("authorization", `Bearer ${mayaToken}`);
    const productId = products.body.data[0].id as string;
    const attack = await request(app).delete(`/api/v1/vendor/products/${productId}`).set("authorization", `Bearer ${leoToken}`);
    expect(attack.status).toBe(404);
  });
});

describe("cart, coupons, stock, and checkout", () => {
  it("rejects an expired coupon", async () => {
    await prisma.coupon.create({ data: { code: "OLD10", type: "PERCENTAGE", value: "10.00", expiresAt: new Date("2020-01-01"), active: true } });
    await request(app).post("/api/v1/cart/items").set(auth(jordanToken)).send({ variantId: mayaVariant, quantity: 1 });
    const quoted = await request(app).put("/api/v1/cart/coupon").set(auth(jordanToken)).send({ code: "OLD10" });
    expect(quoted.status).toBe(400);
    expect(quoted.body.message).toMatch(/expired/i);
    await request(app).put("/api/v1/cart/coupon").set(auth(jordanToken)).send({ code: null });
    await clearCart(jordanToken);
  });

  it("splits a two-vendor order, prices commission from the database, and isolates vendor views", async () => {
    await request(app).post("/api/v1/cart/items").set(auth(jordanToken)).send({ variantId: mayaVariant, quantity: 2 });
    await request(app).post("/api/v1/cart/items").set(auth(jordanToken)).send({ variantId: leoVariant, quantity: 1 });
    const placed = await request(app).post("/api/v1/checkout").set(auth(jordanToken)).set("idempotency-key", "jordan-split-1").send({ shippingMethod: "standard", shippingAddress: address });
    expect(placed.status, JSON.stringify(placed.body)).toBe(200);
    expect(placed.body.data.subtotal).toBe("125.00");
    expect(placed.body.data.shipping).toBe("0.00");
    expect(placed.body.data.tax).toBe("10.00");
    expect(placed.body.data.grandTotal).toBe("135.00");
    expect(placed.body.data.vendorOrders).toHaveLength(2);
    const paid = await request(app).post(`/api/v1/payments/${placed.body.data.payment.id}/confirm`).set(auth(jordanToken)).send({ outcome: "success" });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.data.status).toBe("PAID");

    const mayaOrders = await request(app).get("/api/v1/vendor/orders").set(auth(mayaToken));
    const leoOrders = await request(app).get("/api/v1/vendor/orders").set(auth(leoToken));
    expect(mayaOrders.body.data).toHaveLength(1);
    expect(leoOrders.body.data).toHaveLength(1);
    expect(mayaOrders.body.data[0].orderNumber).not.toBe(leoOrders.body.data[0].orderNumber);
    expect(mayaOrders.body.data[0].commission).toBe("10.00");
    expect(mayaOrders.body.data[0].vendorEarnings).toBe("90.00");
    expect(leoOrders.body.data[0].commission).toBe("2.00");
    expect(leoOrders.body.data[0].vendorEarnings).toBe("23.00");
    expect(mayaOrders.body.data[0].items.every((item: { sku: string }) => item.sku.startsWith("A-"))).toBe(true);
    expect(leoOrders.body.data[0].items.every((item: { sku: string }) => item.sku.startsWith("B-"))).toBe(true);

    const adminOrder = await request(app).get(`/api/v1/admin/orders/${paid.body.data.orderNumber}`).set(auth(adminToken));
    expect(adminOrder.status).toBe(200);
    expect(adminOrder.body.data.vendorOrders).toHaveLength(2);
    const ledger = await prisma.vendorLedger.groupBy({ by: ["type"], _sum: { amount: true } });
    const gross = ledger.find((row) => row.type === "GROSS");
    expect(Number(gross?._sum.amount)).toBeGreaterThan(0);

    const shipped = await request(app).post(`/api/v1/vendor/orders/${mayaOrders.body.data[0].id}/status`).set(auth(mayaToken)).send({ status: "PROCESSING" });
    expect(shipped.status, JSON.stringify(shipped.body)).toBe(200);
    const labeled = await request(app).post(`/api/v1/vendor/orders/${mayaOrders.body.data[0].id}/status`).set(auth(mayaToken)).send({ status: "PACKED" });
    expect(labeled.status).toBe(200);
    const onTheWay = await request(app).post(`/api/v1/vendor/orders/${mayaOrders.body.data[0].id}/status`).set(auth(mayaToken)).send({ status: "SHIPPED", carrier: "USPS", trackingNumber: "9400111899223" });
    expect(onTheWay.status, JSON.stringify(onTheWay.body)).toBe(200);

    const refund = await request(app).post("/api/v1/admin/refunds").set(auth(adminToken)).send({ vendorOrderId: leoOrders.body.data[0].id, reason: "Changed mind", restock: true });
    expect(refund.status, JSON.stringify(refund.body)).toBe(200);
    const parent = await request(app).get(`/api/v1/orders/${paid.body.data.orderNumber}`).set(auth(jordanToken));
    expect(parent.body.data.status).toBe("PARTIALLY_REFUNDED");
    const skillet = await prisma.inventory.findUniqueOrThrow({ where: { variantId: leoVariant } });
    expect(skillet.quantity).toBe(20);
  });

  it("does not oversell the last unit", async () => {
    const second = (await registerCustomer("casey@test.market")).token;
    const firstHold = await request(app).post("/api/v1/cart/items").set(auth(second)).send({ variantId: scarceVariant, quantity: 1 });
    expect(firstHold.status, JSON.stringify(firstHold.body)).toBe(200);
    const held = await request(app).post("/api/v1/checkout").set(auth(second)).send({ shippingMethod: "standard", shippingAddress: address });
    expect(held.status, JSON.stringify(held.body)).toBe(200);
    const third = (await registerCustomer("riley@test.market")).token;
    const blocked = await request(app).post("/api/v1/cart/items").set(auth(third)).send({ variantId: scarceVariant, quantity: 1 });
    expect(blocked.status).toBe(409);
  });
});

async function login(email: string, password: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data.accessToken as string;
}

async function registerVendor(email: string, storeName: string) {
  const response = await request(app).post("/api/v1/auth/register").send({
    email, password: "VendorPass!24", firstName: storeName.split(" ")[0], lastName: "Seller", role: "VENDOR", storeName, storeDescription: "A small studio selling goods we would keep ourselves.",
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return { token: response.body.data.accessToken as string };
}

async function registerCustomer(email: string) {
  const response = await request(app).post("/api/v1/auth/register").send({ email, password: "CustomerPass!24", firstName: "Jordan", lastName: "Lee", role: "CUSTOMER" });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return { token: response.body.data.accessToken as string };
}

async function createProduct(token: string, input: { name: string; sku: string; price: string; quantity: number }) {
  const response = await request(app).post("/api/v1/vendor/products").set(auth(token)).send({
    name: input.name,
    shortDescription: `${input.name} for the test catalog.`,
    description: `${input.name} is a real catalog row used to prove checkout.`,
    categoryId,
    price: input.price,
    sku: input.sku,
    submit: true,
    variants: [{ sku: `${input.sku}-1`, options: { Option: "Default" }, quantity: input.quantity }],
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data.variants[0].id as string;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function clearCart(token: string) {
  const cart = await request(app).get("/api/v1/cart").set(auth(token));
  for (const item of cart.body.data.items) {
    await request(app).delete(`/api/v1/cart/items/${item.id}`).set(auth(token));
  }
}
