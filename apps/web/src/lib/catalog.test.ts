import { listingSearch, money } from "./catalog";

describe("listing search", () => {
  it("keeps shop filters and drops the default sort", () => {
    const query = listingSearch({ q: "merino", category: "apparel", minPrice: "40", inStock: true, sort: "newest", page: 2 });
    expect(query).toContain("q=merino");
    expect(query).toContain("category=apparel");
    expect(query).toContain("minPrice=40");
    expect(query).toContain("inStock=true");
    expect(query).toContain("page=2");
    expect(query).not.toContain("sort=");
  });

  it("formats money from decimal strings", () => {
    expect(money("128.00")).toBe("$128.00");
    expect(money("6.5")).toBe("$6.50");
  });
});
