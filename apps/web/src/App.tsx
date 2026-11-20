import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth, StorefrontLayout } from "./components/chrome";
import { AccountHome, AccountLayout, AddressesPage, OrdersPage, ProfilePage, ReviewsPage, SupportPage, WishlistPage } from "./pages/account";
import { AdminAnalytics, AdminApplications, AdminAudit, AdminCategories, AdminCommissions, AdminCoupons, AdminHome, AdminLayout, AdminOrderDetail, AdminOrders, AdminPayments, AdminPayouts, AdminProducts, AdminRefunds, AdminReports, AdminReviews, AdminSearch, AdminSettings, AdminTransactions, AdminUsers, AdminVendors } from "./pages/admin";
import { ForgotPage, LoginPage, RegisterPage, ResetPage, VerifyPage } from "./pages/auth";
import { CategoryPage, ListingPage, ProductPage, StorePage } from "./pages/catalog";
import { CartPage, CheckoutPage, OrderPage, PayPage } from "./pages/checkout";
import { HomePage } from "./pages/home";
import { EarningsPage, InventoryPage, PayoutsPage, StoreSettings, VendorAnalytics, VendorCoupons, VendorCustomers, VendorHome, VendorLayout, VendorOrderDetail, VendorOrders, VendorProductForm, VendorProducts, VendorProfile, VendorReviews } from "./pages/vendor";

export function App() {
  return (
    <Routes>
      <Route element={<StorefrontLayout />}>
        <Route index element={<HomePage />} />
        <Route path="search" element={<ListingPage />} />
        <Route path="c/:slug" element={<CategoryPage />} />
        <Route path="p/:slug" element={<ProductPage />} />
        <Route path="store/:slug" element={<StorePage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="forgot-password" element={<ForgotPage />} />
        <Route path="reset-password" element={<ResetPage />} />
        <Route path="verify-email" element={<VerifyPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route element={<RequireAuth roles={["CUSTOMER", "ADMIN"]} />}>
          <Route path="checkout" element={<CheckoutPage />} />
          <Route path="pay/:orderNumber" element={<PayPage />} />
          <Route path="orders/:orderNumber" element={<OrderPage />} />
        </Route>
      </Route>

      <Route element={<RequireAuth roles={["CUSTOMER"]} />}>
        <Route path="account" element={<AccountLayout />}>
          <Route index element={<AccountHome />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="wishlist" element={<WishlistPage />} />
          <Route path="addresses" element={<AddressesPage />} />
          <Route path="reviews" element={<ReviewsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route element={<RequireAuth roles={["VENDOR"]} />}>
        <Route path="vendor" element={<VendorLayout />}>
          <Route index element={<VendorHome />} />
          <Route path="products" element={<VendorProducts />} />
          <Route path="products/new" element={<VendorProductForm />} />
          <Route path="products/:id" element={<VendorProductForm />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="orders" element={<VendorOrders />} />
          <Route path="orders/:id" element={<VendorOrderDetail />} />
          <Route path="customers" element={<VendorCustomers />} />
          <Route path="coupons" element={<VendorCoupons />} />
          <Route path="reviews" element={<VendorReviews />} />
          <Route path="store" element={<StoreSettings />} />
          <Route path="earnings" element={<EarningsPage />} />
          <Route path="payouts" element={<PayoutsPage />} />
          <Route path="analytics" element={<VendorAnalytics />} />
          <Route path="profile" element={<VendorProfile />} />
        </Route>
      </Route>

      <Route element={<RequireAuth roles={["ADMIN"]} />}>
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<AdminHome />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="customers" element={<AdminUsers role="CUSTOMER" />} />
          <Route path="vendors" element={<AdminVendors />} />
          <Route path="applications" element={<AdminApplications />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="categories" element={<AdminCategories />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="orders/:orderNumber" element={<AdminOrderDetail />} />
          <Route path="payments" element={<AdminPayments />} />
          <Route path="transactions" element={<AdminTransactions />} />
          <Route path="commissions" element={<AdminCommissions />} />
          <Route path="payouts" element={<AdminPayouts />} />
          <Route path="refunds" element={<AdminRefunds />} />
          <Route path="coupons" element={<AdminCoupons />} />
          <Route path="reviews" element={<AdminReviews />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="analytics" element={<AdminAnalytics />} />
          <Route path="search" element={<AdminSearch />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="audit" element={<AdminAudit />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
