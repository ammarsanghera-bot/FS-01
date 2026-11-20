import { Prisma } from "@prisma/client";
import { env } from "../config.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { availableOf } from "./present.js";

export type ProductListFilters = {
  q?: string;
  category?: string;
  vendor?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  rating?: number;
  inStock?: boolean;
  sort?: string;
  page: number;
  pageSize: number;
  ids?: string[];
};

let engineCache: "postgresql" | "elasticsearch" | null = null;

export function resetSearchEngineCache(): void {
  engineCache = null;
}

export async function activeSearchEngine(): Promise<"postgresql" | "elasticsearch"> {
  if (engineCache) return engineCache;
  if (!env.elasticsearchUrl) {
    engineCache = "postgresql";
    return engineCache;
  }
  try {
    const response = await fetch(env.elasticsearchUrl, { signal: AbortSignal.timeout(2000) });
    engineCache = response.ok ? "elasticsearch" : "postgresql";
  } catch {
    engineCache = "postgresql";
  }
  logger.info({ engine: engineCache }, "search engine selected");
  return engineCache;
}

export async function listProductIds(filters: ProductListFilters): Promise<{ ids: string[]; total: number; engine: string }> {
  if (filters.q && (await activeSearchEngine()) === "elasticsearch") {
    try {
      return await elasticsearchList(filters);
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : "search failed" }, "elasticsearch failed, using postgresql");
    }
  }
  return postgresList(filters);
}

export async function suggestProducts(q: string) {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  return prisma.product.findMany({
    where: {
      status: "APPROVED",
      deletedAt: null,
      store: { status: "APPROVED" },
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { sku: { contains: term, mode: "insensitive" } },
        { tags: { has: term.toLowerCase() } },
      ],
    },
    select: { name: true, slug: true },
    orderBy: [{ salesCount: "desc" }, { name: "asc" }],
    take: 8,
  });
}

export async function indexProduct(productId: string): Promise<void> {
  if ((await activeSearchEngine()) !== "elasticsearch") return;
  const product = await loadIndexProduct(productId);
  if (!product || product.deletedAt || product.status !== "APPROVED" || product.store.status !== "APPROVED") {
    await removeProduct(productId);
    return;
  }
  await ensureIndex();
  const response = await fetch(`${env.elasticsearchUrl}/${env.elasticsearchIndex}/_doc/${product.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(toDocument(product)),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`elasticsearch index failed (${response.status})`);
}

export async function removeProduct(productId: string): Promise<void> {
  if ((await activeSearchEngine()) !== "elasticsearch" || !env.elasticsearchUrl) return;
  await fetch(`${env.elasticsearchUrl}/${env.elasticsearchIndex}/_doc/${productId}`, { method: "DELETE", signal: AbortSignal.timeout(4000) }).catch(() => undefined);
}

export async function reindexAll(): Promise<{ engine: string; count: number }> {
  const engine = await activeSearchEngine();
  const products = await prisma.product.findMany({
    where: { deletedAt: null, status: "APPROVED", store: { status: "APPROVED" } },
    select: { id: true },
  });
  if (engine === "elasticsearch") {
    await ensureIndex();
    for (const product of products) await indexProduct(product.id);
  }
  return { engine, count: products.length };
}

async function postgresList(filters: ProductListFilters): Promise<{ ids: string[]; total: number; engine: string }> {
  const where = whereSql(filters);
  const order = orderSql(filters);
  const offset = (filters.page - 1) * filters.pageSize;
  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id
      FROM "Product" p
      JOIN "Store" s ON s.id = p."storeId"
      JOIN "Category" c ON c.id = p."categoryId"
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ${filters.pageSize} OFFSET ${offset}
    `,
    prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "Product" p
      JOIN "Store" s ON s.id = p."storeId"
      JOIN "Category" c ON c.id = p."categoryId"
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      WHERE ${where}
    `,
  ]);
  return { ids: rows.map((row) => row.id), total: countRows[0]?.count ?? 0, engine: "postgresql" };
}

function whereSql(filters: ProductListFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`p.status = 'APPROVED'`,
    Prisma.sql`p."deletedAt" IS NULL`,
    Prisma.sql`s.status = 'APPROVED'`,
    Prisma.sql`c."isActive" = true`,
  ];
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    parts.push(Prisma.sql`(
      to_tsvector('english', concat_ws(' ', p.name, p."shortDescription", p.description, p.sku, array_to_string(p.tags, ' '), c.name, b.name, s.name))
      @@ plainto_tsquery('english', ${q})
      OR p.name ILIKE ${like} ESCAPE '\\'
      OR p.sku ILIKE ${like} ESCAPE '\\'
    )`);
  }
  if (filters.category) parts.push(Prisma.sql`c.slug = ${filters.category}`);
  if (filters.vendor) parts.push(Prisma.sql`s.slug = ${filters.vendor}`);
  if (filters.brand) parts.push(Prisma.sql`b.slug = ${filters.brand}`);
  if (filters.minPrice != null) parts.push(Prisma.sql`p.price >= ${filters.minPrice}`);
  if (filters.maxPrice != null) parts.push(Prisma.sql`p.price <= ${filters.maxPrice}`);
  if (filters.rating != null) parts.push(Prisma.sql`p."ratingAvg" >= ${filters.rating}`);
  if (filters.ids?.length) parts.push(Prisma.sql`p.id IN (${Prisma.join(filters.ids)})`);
  if (filters.inStock) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductVariant" v
      JOIN "Inventory" i ON i."variantId" = v.id
      WHERE v."productId" = p.id AND (i.quantity - i.reserved) > 0
    )`);
  }
  return parts.slice(1).reduce((clause, part) => Prisma.sql`${clause} AND ${part}`, parts[0]);
}

function orderSql(filters: ProductListFilters): Prisma.Sql {
  const q = filters.q?.trim();
  switch (filters.sort) {
    case "price_asc":
      return Prisma.sql`p.price ASC, p.id ASC`;
    case "price_desc":
      return Prisma.sql`p.price DESC, p.id ASC`;
    case "rating":
      return Prisma.sql`p."ratingAvg" DESC, p."ratingCount" DESC, p.id ASC`;
    case "popularity":
      return Prisma.sql`p."salesCount" DESC, p.id ASC`;
    case "relevance":
      return q
        ? Prisma.sql`ts_rank(to_tsvector('english', concat_ws(' ', p.name, p."shortDescription", p.description, p.sku, array_to_string(p.tags, ' '), c.name, b.name, s.name)), plainto_tsquery('english', ${q})) DESC, p.id ASC`
        : Prisma.sql`p."createdAt" DESC, p.id ASC`;
    default:
      return Prisma.sql`p."createdAt" DESC, p.id ASC`;
  }
}

async function elasticsearchList(filters: ProductListFilters): Promise<{ ids: string[]; total: number; engine: string }> {
  await ensureIndex();
  const filter: Record<string, unknown>[] = [{ term: { status: "APPROVED" } }];
  if (filters.category) filter.push({ term: { categorySlug: filters.category } });
  if (filters.vendor) filter.push({ term: { vendorSlug: filters.vendor } });
  if (filters.inStock) filter.push({ term: { inStock: true } });
  if (filters.rating != null) filter.push({ range: { rating: { gte: filters.rating } } });
  if (filters.minPrice != null || filters.maxPrice != null) {
    filter.push({ range: { price: { gte: filters.minPrice, lte: filters.maxPrice } } });
  }
  const sort =
    filters.sort === "price_asc" ? [{ price: "asc" }] :
    filters.sort === "price_desc" ? [{ price: "desc" }] :
    filters.sort === "rating" ? [{ rating: "desc" }] :
    filters.sort === "popularity" ? [{ salesCount: "desc" }] :
    filters.q ? ["_score"] : [{ salesCount: "desc" }];
  const response = await fetch(`${env.elasticsearchUrl}/${env.elasticsearchIndex}/_search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(4000),
    body: JSON.stringify({
      from: (filters.page - 1) * filters.pageSize,
      size: filters.pageSize,
      query: {
        bool: {
          must: filters.q
            ? [{ multi_match: { query: filters.q, fields: ["name^3", "sku^2", "tags", "category", "brand", "vendor", "description"] } }]
            : [{ match_all: {} }],
          filter,
        },
      },
      sort,
    }),
  });
  if (!response.ok) throw new Error(`elasticsearch search failed (${response.status})`);
  const payload = (await response.json()) as { hits?: { total?: { value?: number }; hits?: { _id: string }[] } };
  return {
    ids: payload.hits?.hits?.map((hit) => hit._id) ?? [],
    total: payload.hits?.total?.value ?? 0,
    engine: "elasticsearch",
  };
}

async function ensureIndex(): Promise<void> {
  const head = await fetch(`${env.elasticsearchUrl}/${env.elasticsearchIndex}`, { method: "HEAD", signal: AbortSignal.timeout(3000) });
  if (head.ok) return;
  await fetch(`${env.elasticsearchUrl}/${env.elasticsearchIndex}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mappings: {
        properties: {
          name: { type: "text" },
          description: { type: "text" },
          sku: { type: "keyword" },
          tags: { type: "keyword" },
          category: { type: "text" },
          categorySlug: { type: "keyword" },
          brand: { type: "text" },
          vendor: { type: "text" },
          vendorSlug: { type: "keyword" },
          price: { type: "double" },
          rating: { type: "double" },
          inStock: { type: "boolean" },
          status: { type: "keyword" },
          slug: { type: "keyword" },
          salesCount: { type: "integer" },
        },
      },
    }),
  });
}

function loadIndexProduct(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: { category: true, brand: true, store: true, variants: { include: { inventory: true } } },
  });
}

function toDocument(product: NonNullable<Awaited<ReturnType<typeof loadIndexProduct>>>) {
  return {
    name: product.name,
    description: `${product.shortDescription} ${product.description}`,
    sku: product.sku,
    tags: product.tags,
    category: product.category.name,
    categorySlug: product.category.slug,
    brand: product.brand?.name ?? "",
    vendor: product.store.name,
    vendorSlug: product.store.slug,
    price: Number(product.price),
    rating: Number(product.ratingAvg),
    inStock: product.variants.some((variant) => availableOf(variant.inventory) > 0),
    status: product.status,
    slug: product.slug,
    salesCount: product.salesCount,
  };
}
