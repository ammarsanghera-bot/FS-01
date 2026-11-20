import { slugify } from "@marketplace/shared";
import { hashPassword } from "../apps/api/src/lib/password.js";
import { prisma } from "../apps/api/src/lib/prisma.js";
import { getRedis } from "../apps/api/src/lib/redis.js";
import { checkout, confirmPayment, createPayout, setPayoutStatus, updateVendorFulfillment } from "../apps/api/src/domain/commerce.js";
import { createReview, moderateReview } from "../apps/api/src/domain/reviews.js";
import { saveSettings, SETTING_DEFAULTS } from "../apps/api/src/domain/settings.js";
import { brands, categories, products } from "./data/catalog.js";

const addressFor = (name: string, city: string) => ({
  fullName: name,
  line1: "18 Pearl Street",
  city,
  state: city === "Portland" ? "OR" : city === "Hudson" ? "NY" : "CA",
  postalCode: city === "Portland" ? "97214" : city === "Hudson" ? "12534" : "94110",
  country: "US",
});

async function main() {
  await prisma.$executeRawUnsafe(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations') LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);

  await saveSettings(SETTING_DEFAULTS);
  const adminPassword = await hashPassword("NorthstarAdmin!24");
  const vendorPassword = await hashPassword("VendorPass!24");
  const customerPassword = await hashPassword("CustomerPass!24");

  const admin = await prisma.user.create({
    data: { email: "admin@northstar.market", passwordHash: adminPassword, role: "ADMIN", firstName: "Amina", lastName: "Shah", emailVerifiedAt: new Date(), status: "ACTIVE" },
  });

  const categoryIds = new Map<string, string>();
  for (const [index, category] of categories.entries()) {
    const [slug, name, description, imageUrl, commission] = category;
    const created = await prisma.category.create({
      data: { slug, name, description, imageUrl, sortOrder: index, commissionRate: commission ? commission.toFixed(2) : null },
    });
    categoryIds.set(slug, created.id);
  }
  const brandIds = new Map<string, string>();
  for (const [slug, name, description] of brands) {
    const created = await prisma.brand.create({ data: { slug, name, description } });
    brandIds.set(slug, created.id);
  }

  const stores = {
    "atelier-maya": await makeVendor({ email: "maya.chen@atelier.market", firstName: "Maya", lastName: "Chen", password: vendorPassword, storeName: "Atelier Maya", slug: "atelier-maya", city: "Hudson", region: "New York", description: "Maya Chen cuts shirts, knits, and coats in small runs. The fit is easy and the cloth is chosen to last past a season.", commission: null }),
    "field-and-co": await makeVendor({ email: "leo.hart@fieldandco.market", firstName: "Leo", lastName: "Hart", password: vendorPassword, storeName: "Field & Co.", slug: "field-and-co", city: "Bend", region: "Oregon", description: "Leo Hart sells the pans, knives, and trail kit he uses himself. Nothing here has a feature you will not touch.", commission: "8.00" }),
    "harbor-home": await makeVendor({ email: "nora.ellis@harborhome.market", firstName: "Nora", lastName: "Ellis", password: vendorPassword, storeName: "Harbor Home", slug: "harbor-home", city: "Portland", region: "Oregon", description: "Nora Ellis edits lamps, linen, and paper goods for rooms that get used every day.", commission: null }),
  };

  await prisma.user.create({
    data: {
      email: "sam.okafor@pending.market",
      passwordHash: vendorPassword,
      role: "VENDOR",
      firstName: "Sam",
      lastName: "Okafor",
      emailVerifiedAt: new Date(),
      vendorProfile: { create: { legalName: "Okafor Ceramics", status: "PENDING" } },
      vendorApplication: {
        create: {
          storeName: "Okafor Ceramics",
          slug: "okafor-ceramics",
          description: "Tableware fired in a small kiln outside Sacramento. Applying to sell bowls and cups.",
          contactEmail: "sam.okafor@pending.market",
          city: "Sacramento",
          region: "California",
          country: "US",
          legalName: "Okafor Ceramics",
          status: "PENDING",
        },
      },
    },
  });

  for (const item of products) {
    const store = stores[item.store];
    const product = await prisma.product.create({
      data: {
        storeId: store.storeId,
        categoryId: categoryIds.get(item.category)!,
        brandId: brandIds.get(item.brand)!,
        name: item.name,
        slug: slugify(item.name),
        sku: item.variants[0].sku.split("-").slice(0, 2).join("-"),
        description: `${item.blurb} Made in ${item.material}. ${store.name} ships it from ${store.city}.`,
        shortDescription: item.blurb,
        price: item.price,
        compareAtPrice: item.compareAt ?? null,
        status: "APPROVED",
        publishedAt: new Date(),
        isFeatured: Boolean(item.featured),
        tags: item.tags,
        weightGrams: item.weight,
        shippingInfo: "Ships in 2 business days. Standard delivery is 5–7 days, express is 2–3.",
        images: {
          create: [0, 1].map((index) => ({
            url: `https://picsum.photos/seed/northstar-${slugify(item.name)}-${index}/1000/1200`,
            alt: item.name,
            sortOrder: index,
          })),
        },
        attributes: {
          create: [
            { name: "Material", values: { create: [{ value: item.material }] } },
            { name: "Seller", values: { create: [{ value: store.name }] } },
          ],
        },
      },
    });
    for (const variant of item.variants) {
      const created = await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: variant.sku,
          name: Object.values(variant.options).join(" / "),
          options: variant.options,
          inventory: { create: { productId: product.id, quantity: variant.quantity, lowStockThreshold: 5 } },
        },
        include: { inventory: true },
      });
      await prisma.inventoryMovement.create({
        data: { inventoryId: created.inventory!.id, type: "ADJUSTMENT", onHandDelta: variant.quantity, reservedDelta: 0, reason: "Opening stock" },
      });
      bySkuGlobal.set(variant.sku, { variantId: created.id, productId: product.id });
    }
  }

  const mayaStore = stores["atelier-maya"].storeId;
  const draft = await prisma.product.create({
    data: { storeId: mayaStore, categoryId: categoryIds.get("apparel")!, name: "Sample Chore Shirt", slug: "sample-chore-shirt", sku: "DRAFT-1", description: "A draft that is not on the shop yet.", shortDescription: "Draft product for the vendor queue.", price: "96.00", status: "DRAFT", tags: ["draft"] },
  });
  const draftVariant = await prisma.productVariant.create({ data: { productId: draft.id, sku: "DRAFT-1-M", name: "M", options: { Size: "M" } } });
  await prisma.inventory.create({ data: { productId: draft.id, variantId: draftVariant.id, quantity: 4 } });
  const pending = await prisma.product.create({
    data: { storeId: mayaStore, categoryId: categoryIds.get("apparel")!, name: "Unreviewed Cardigan", slug: "unreviewed-cardigan", sku: "PEND-1", description: "Waiting on an admin.", shortDescription: "Pending approval.", price: "164.00", status: "PENDING_APPROVAL", tags: ["pending"] },
  });
  const pendingVariant = await prisma.productVariant.create({ data: { productId: pending.id, sku: "PEND-1-M", name: "M", options: { Size: "M" } } });
  await prisma.inventory.create({ data: { productId: pending.id, variantId: pendingVariant.id, quantity: 3 } });
  const rejected = await prisma.product.create({
    data: { storeId: mayaStore, categoryId: categoryIds.get("apparel")!, name: "Logo Tee", slug: "logo-tee", sku: "REJ-1", description: "Rejected because the marketplace does not carry logo tees.", shortDescription: "Rejected sample.", price: "36.00", status: "REJECTED", rejectionReason: "Northstar does not list logo merchandise.", tags: ["rejected"] },
  });
  const rejectedVariant = await prisma.productVariant.create({ data: { productId: rejected.id, sku: "REJ-1-M", name: "M", options: { Size: "M" } } });
  await prisma.inventory.create({ data: { productId: rejected.id, variantId: rejectedVariant.id, quantity: 2 } });

  const customers = [
    ["jordan.lee@example.com", "Jordan", "Lee", "Portland"],
    ["avery.singh@example.com", "Avery", "Singh", "Portland"],
    ["riley.chen@example.com", "Riley", "Chen", "Hudson"],
    ["morgan.patel@example.com", "Morgan", "Patel", "Portland"],
    ["casey.nguyen@example.com", "Casey", "Nguyen", "San Francisco"],
    ["quinn.brooks@example.com", "Quinn", "Brooks", "Portland"],
    ["taylor.ortiz@example.com", "Taylor", "Ortiz", "Hudson"],
    ["drew.alvarez@example.com", "Drew", "Alvarez", "San Francisco"],
    ["reese.kim@example.com", "Reese", "Kim", "Portland"],
    ["parker.diaz@example.com", "Parker", "Diaz", "Hudson"],
    ["skyler.ward@example.com", "Skyler", "Ward", "Portland"],
    ["rowan.ellis@example.com", "Rowan", "Ellis", "San Francisco"],
  ] as const;
  const people = new Map<string, { id: string; name: string; city: string }>();
  for (const [email, firstName, lastName, city] of customers) {
    const user = await prisma.user.create({
      data: { email, passwordHash: customerPassword, role: "CUSTOMER", firstName, lastName, emailVerifiedAt: new Date(), customerProfile: { create: {} } },
    });
    await prisma.address.create({ data: { userId: user.id, ...addressFor(`${firstName} ${lastName}`, city), isDefaultShipping: true, isDefaultBilling: true } });
    people.set(email, { id: user.id, name: `${firstName} ${lastName}`, city });
  }

  await prisma.coupon.createMany({
    data: [
      { code: "WELCOME10", type: "PERCENTAGE", value: "10.00", minOrder: "40.00", perUserLimit: 1, usageLimit: 200, description: "Ten percent off your first order over $40." },
      { code: "FIELD5", type: "FIXED", value: "5.00", minOrder: "30.00", storeId: stores["field-and-co"].storeId, description: "Five dollars off Field & Co." },
      { code: "FREESHIP", type: "FREE_SHIPPING", value: "0.00", description: "Free shipping on the whole order." },
      { code: "OLD10", type: "PERCENTAGE", value: "10.00", expiresAt: new Date("2024-01-01"), description: "Expired welcome offer." },
      { code: "PAUSED", type: "FIXED", value: "15.00", active: false, description: "Turned off by an admin." },
    ],
  });

  const jordan = people.get("jordan.lee@example.com")!;
  const jordanOrder = await place(jordan, [{ sku: "MC-NV-M", quantity: 1 }, { sku: "SK-10", quantity: 1 }], true);
  await fulfill(jordanOrder, stores["atelier-maya"], "DELIVERED");
  await fulfill(jordanOrder, stores["field-and-co"], "DELIVERED");
  const avery = await place(people.get("avery.singh@example.com")!, [{ sku: "DV-QN-IV", quantity: 1 }, { sku: "KT-CR", quantity: 1 }], true);
  await fulfill(avery, stores["harbor-home"], "SHIPPED");
  await fulfill(avery, stores["field-and-co"], "PROCESSING");
  const riley = await place(people.get("riley.chen@example.com")!, [{ sku: "KN-8", quantity: 1 }, { sku: "BD-MD", quantity: 1 }], true);
  await fulfill(riley, stores["field-and-co"], "DELIVERED");
  await place(people.get("morgan.patel@example.com")!, [{ sku: "OC-CM-M", quantity: 1 }], true);
  await place(people.get("casey.nguyen@example.com")!, [{ sku: "TOTE-NT", quantity: 1 }, { sku: "MUG-SP", quantity: 2 }], false);
  const quinn = await place(people.get("quinn.brooks@example.com")!, [{ sku: "LMP-SD", quantity: 1 }, { sku: "OIL-30", quantity: 1 }, { sku: "MUG-SP", quantity: 1 }], true);
  await fulfill(quinn, stores["harbor-home"], "PROCESSING");
  const taylor = await place(people.get("taylor.ortiz@example.com")!, [{ sku: "NB-NV", quantity: 1 }, { sku: "PEN-BK", quantity: 1 }], true, "WELCOME10");
  await fulfill(taylor, stores["harbor-home"], "DELIVERED");
  const drew = await place(people.get("drew.alvarez@example.com")!, [{ sku: "CC-IN-M", quantity: 1 }, { sku: "TH-CH", quantity: 1 }], true);
  await fulfill(drew, stores["atelier-maya"], "SHIPPED");
  await fulfill(drew, stores["harbor-home"], "PACKED");

  const oil = bySkuGlobal.get("OIL-30")!;
  const quinnVendor = quinn.vendorOrders.find((order) => order.items.some((item) => item.productId === oil.productId));
  if (quinnVendor) {
    const { refundVendorOrder } = await import("../apps/api/src/domain/commerce.js");
    await refundVendorOrder({ vendorOrderId: quinnVendor.id, actorId: admin.id, reason: "The bottle arrived cracked.", restock: true });
  }

  for (const sku of ["MC-NV-M", "SK-10", "KN-8", "NB-NV"]) {
    const ref = bySkuGlobal.get(sku)!;
    const buyer = sku === "NB-NV" ? taylor.userId : sku === "KN-8" ? riley.userId : jordanOrder.userId;
    const review = await createReview(buyer, {
      productId: ref.productId,
      rating: sku === "KN-8" ? 5 : 4,
      title: sku === "KN-8" ? "Stays sharp" : "Worth keeping",
      body: sku === "KN-8"
        ? "The edge arrived even and the handle does not slip when the board is wet."
        : "It is what the description said. The cloth feels right and the size chart matched.",
    });
    await moderateReview(review.id, admin.id, "APPROVED");
  }
  const knifeReview = await prisma.review.findFirst({ where: { product: { sku: { startsWith: "KN" } } } });
  if (knifeReview) {
    await prisma.review.update({ where: { id: knifeReview.id }, data: { vendorResponse: "Glad the edge is holding. A ceramic steel is enough between stones." } });
  }

  const wish = await prisma.wishlist.create({ data: { userId: jordan.id } });
  for (const sku of ["OC-CM-M", "LMP-SD", "PK-OL"]) {
    const ref = bySkuGlobal.get(sku);
    if (ref) await prisma.wishlistItem.create({ data: { wishlistId: wish.id, productId: ref.productId } });
  }

  const { storeBalance } = await import("../apps/api/src/domain/commerce.js");
  const mayaBalance = await storeBalance(stores["atelier-maya"].storeId);
  if (mayaBalance.availableCents > 2000) {
    const payout = await createPayout({ storeId: stores["atelier-maya"].storeId, amount: "20.00", actorId: admin.id, notes: "Sample payout for the demo ledger." });
    await setPayoutStatus({ payoutId: payout.id, status: "PAID", actorId: admin.id });
  }
  const fieldBalance = await storeBalance(stores["field-and-co"].storeId);
  if (fieldBalance.availableCents > 1000) {
    await createPayout({ storeId: stores["field-and-co"].storeId, amount: "10.00", actorId: admin.id, notes: "Waiting on the mock payout run." });
  }

  await prisma.auditLog.create({ data: { actorId: admin.id, action: "seed.completed", entity: "Platform", metadata: { products: products.length } } });
  console.log(`Seeded ${products.length} live products, ${customers.length} customers, and demo orders.`);
}

async function makeVendor(input: { email: string; firstName: string; lastName: string; password: string; storeName: string; slug: string; city: string; region: string; description: string; commission: string | null }) {
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: input.password,
      role: "VENDOR",
      firstName: input.firstName,
      lastName: input.lastName,
      emailVerifiedAt: new Date(),
      vendorProfile: { create: { legalName: input.storeName, status: "APPROVED", phone: "503-555-0148" } },
    },
    include: { vendorProfile: true },
  });
  const store = await prisma.store.create({
    data: {
      vendorProfileId: user.vendorProfile!.id,
      name: input.storeName,
      slug: input.slug,
      description: input.description,
      contactEmail: input.email,
      city: input.city,
      region: input.region,
      country: "US",
      status: "APPROVED",
      commissionRate: input.commission,
      logoUrl: `https://picsum.photos/seed/${input.slug}-logo/200/200`,
      coverUrl: `https://picsum.photos/seed/${input.slug}-cover/1600/700`,
      returnPolicy: "Returns are accepted within 30 days if the item is unworn and in its original packing.",
      shippingPolicy: "Orders leave the studio within two business days.",
    },
  });
  await prisma.vendorApplication.create({
    data: {
      userId: user.id,
      storeName: input.storeName,
      slug: input.slug,
      description: input.description,
      contactEmail: input.email,
      city: input.city,
      region: input.region,
      country: "US",
      legalName: input.storeName,
      status: "APPROVED",
      reviewedAt: new Date(),
    },
  });
  return { userId: user.id, storeId: store.id, name: store.name, city: input.city };
}

async function place(person: { id: string; name: string; city: string }, lines: { sku: string; quantity: number }[], pay: boolean, coupon?: string) {
  await prisma.cart.deleteMany({ where: { userId: person.id } });
  await prisma.cart.create({
    data: {
      userId: person.id,
      couponCode: coupon,
      items: {
        create: lines.map((line) => {
          const ref = bySkuGlobal.get(line.sku);
          if (!ref) throw new Error(`Missing SKU ${line.sku}`);
          return { variantId: ref.variantId, productId: ref.productId, quantity: line.quantity };
        }),
      },
    },
  });
  const order = await checkout({
    userId: person.id,
    shippingMethod: "standard",
    couponCode: coupon,
    shippingAddress: addressFor(person.name, person.city),
    billingAddress: addressFor(person.name, person.city),
    idempotencyKey: `seed-${person.id}-${lines.map((line) => line.sku).join("-")}`,
  });
  if (!pay) return order;
  return confirmPayment({ paymentId: order.payments.at(-1)!.id, actor: { id: person.id, role: "CUSTOMER" }, outcome: "success" });
}

async function fulfill(order: { id: string; vendorOrders: { id: string; storeId: string; items: { productId: string }[] }[] }, store: { userId: string; storeId: string }, target: "PROCESSING" | "PACKED" | "SHIPPED" | "DELIVERED") {
  const vendorOrder = order.vendorOrders.find((item) => item.storeId === store.storeId);
  if (!vendorOrder) return;
  const steps = ["PROCESSING", "PACKED", "SHIPPED", "DELIVERED"] as const;
  for (const status of steps) {
    await updateVendorFulfillment({
      vendorOrderId: vendorOrder.id,
      actor: { id: store.userId, role: "VENDOR" },
      storeId: store.storeId,
      status,
      carrier: status === "SHIPPED" ? "USPS" : undefined,
      trackingNumber: status === "SHIPPED" ? `9400${vendorOrder.id.slice(-8)}` : undefined,
    });
    if (status === target) break;
  }
}

const bySkuGlobal = new Map<string, { variantId: string; productId: string }>();

async function shutdown(code: number) {
  getRedis()?.disconnect();
  await Promise.race([prisma.$disconnect(), new Promise((resolve) => setTimeout(resolve, 2000))]);
  process.exit(code);
}

main().then(() => shutdown(0)).catch(async (error) => {
  console.error(error);
  await shutdown(1);
});
