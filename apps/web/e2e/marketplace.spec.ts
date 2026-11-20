import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string, pass: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function addProduct(page: Page, slug: string) {
  await page.goto(`/p/${slug}`);
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByText("Added to cart")).toBeVisible();
}

test("customer, two vendors, admin, and a review", async ({ page }) => {
  const email = `buyer.${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Buyer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("BuyerPass!24");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /Hello, Ada/ })).toBeVisible();

  await page.goto("/");
  await page.getByTestId("search").fill("merino");
  await page.locator("form").filter({ has: page.getByTestId("search") }).press("Enter");
  await expect(page.getByRole("heading", { name: /Results for/ })).toBeVisible();
  await page.goto("/c/apparel");
  await page.getByLabel("In stock").check();
  await expect(page.getByTestId("product-card").first()).toBeVisible();

  await addProduct(page, "canvas-market-tote");
  await addProduct(page, "speckled-camp-mug");
  await page.goto("/cart");
  await expect(page.getByText("Canvas Market Tote")).toBeVisible();
  await expect(page.getByText("Speckled Camp Mug")).toBeVisible();
  await page.getByTestId("checkout").click();
  await page.getByLabel("fullName").fill("Ada Buyer");
  await page.getByLabel("line1").fill("18 Pearl Street");
  await page.getByLabel("city").fill("Portland");
  await page.getByLabel("state").fill("OR");
  await page.getByLabel("postalCode").fill("97214");
  await page.getByTestId("place-order").click();
  await page.getByLabel("Name on card").fill("Ada Buyer");
  await page.getByLabel("Card number").fill("4242424242424242");
  await page.getByLabel("Expiry").fill("12/28");
  await page.getByLabel("CVC").fill("123");
  await page.getByTestId("pay").click();
  const orderNumber = await page.getByTestId("order-number").innerText();
  await expect(page.getByTestId("suborder")).toHaveCount(2);
  await expect(page.getByText("Atelier Maya")).toBeVisible();
  await expect(page.getByText("Field & Co.")).toBeVisible();

  await page.goto("/p/canvas-market-tote");
  await page.getByPlaceholder("Title").fill("Holds the market");
  await page.getByPlaceholder("What was it like to use?").fill("The canvas stands up and the straps sit comfortably.");
  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.getByText("Review submitted for moderation")).toBeVisible();

  await login(page, "maya.chen@atelier.market", "VendorPass!24");
  await page.goto("/vendor/orders");
  await expect(page.getByText("Canvas Market Tote").first()).toBeVisible();
  await expect(page.getByText("Speckled Camp Mug")).toHaveCount(0);
  await page.getByTestId("vendor-order").filter({ hasText: "Canvas Market Tote" }).first().getByRole("link").click();
  await expect(page.getByText(/Earnings/)).toBeVisible();
  await page.getByTestId("status-PROCESSING").click();
  await page.getByTestId("status-PACKED").click();
  await page.getByLabel("Tracking number").fill("9400111899");
  await page.getByTestId("status-SHIPPED").click();
  await expect(page.getByText("9400111899")).toBeVisible();

  await login(page, "leo.hart@fieldandco.market", "VendorPass!24");
  await page.goto("/vendor/orders");
  await expect(page.getByText("Speckled Camp Mug").first()).toBeVisible();
  await expect(page.getByText("Canvas Market Tote")).toHaveCount(0);

  await login(page, "admin@northstar.market", "NorthstarAdmin!24");
  await page.goto(`/admin/orders/${orderNumber}`);
  await expect(page.getByTestId("admin-order")).toHaveText(orderNumber);
  await expect(page.getByTestId("admin-suborder")).toHaveCount(2);
  await expect(page.getByText("Commission $6.40 · Earnings $57.60")).toBeVisible();
  await expect(page.getByText("Commission $2.24 · Earnings $25.76")).toBeVisible();
});

test("login form rejects an empty password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("jordan.lee@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Password is required")).toBeVisible();
});
