export type ListingInput = {
  q?: string;
  category?: string;
  vendor?: string;
  brand?: string;
  minPrice?: string;
  maxPrice?: string;
  rating?: string;
  inStock?: boolean;
  sort?: string;
  page?: number;
  pageSize?: number;
};

export function listingSearch(input: ListingInput): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | undefined) => {
    if (value && value.trim()) params.set(key, value.trim());
  };
  set("q", input.q);
  set("category", input.category);
  set("vendor", input.vendor);
  set("brand", input.brand);
  set("minPrice", input.minPrice);
  set("maxPrice", input.maxPrice);
  set("rating", input.rating);
  set("sort", input.sort && input.sort !== "newest" ? input.sort : undefined);
  if (input.inStock) params.set("inStock", "true");
  if (input.page && input.page > 1) params.set("page", String(input.page));
  if (input.pageSize) params.set("pageSize", String(input.pageSize));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function money(value: string | number | null | undefined): string {
  if (value == null || value === "") return "$0.00";
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export function labelize(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const recentKey = "northstar.recent";

export function rememberProduct(id: string) {
  const current = readRecent();
  const next = [id, ...current.filter((item) => item !== id)].slice(0, 8);
  localStorage.setItem(recentKey, JSON.stringify(next));
}

export function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(recentKey) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function optionsOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export const vendorNextStatus: Record<string, string[]> = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
};
