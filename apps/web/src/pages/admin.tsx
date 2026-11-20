import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardLayout, usePageTitle } from "../components/chrome";
import { Button, ErrorNote, StatusBadge, controlClass } from "../components/ui";
import { api } from "../lib/api";
import { money } from "../lib/catalog";
import { useSession } from "../stores/session";

export const adminLinks = [
  { to: "/admin", label: "Dashboard" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/customers", label: "Customers" },
  { to: "/admin/vendors", label: "Vendors" },
  { to: "/admin/applications", label: "Applications" },
  { to: "/admin/products", label: "Products" },
  { to: "/admin/categories", label: "Categories" },
  { to: "/admin/orders", label: "Orders" },
  { to: "/admin/payments", label: "Payments" },
  { to: "/admin/transactions", label: "Transactions" },
  { to: "/admin/commissions", label: "Commissions" },
  { to: "/admin/payouts", label: "Payouts" },
  { to: "/admin/refunds", label: "Refunds" },
  { to: "/admin/coupons", label: "Coupons" },
  { to: "/admin/reviews", label: "Reviews" },
  { to: "/admin/reports", label: "Reports" },
  { to: "/admin/analytics", label: "Analytics" },
  { to: "/admin/search", label: "Search" },
  { to: "/admin/settings", label: "Settings" },
  { to: "/admin/audit", label: "Audit" },
];

export function AdminLayout() {
  return <DashboardLayout title="Platform" links={adminLinks} />;
}

type Overview = {
  grossSales: string;
  gmv: string;
  averageOrderValue: string;
  orders: number;
  platformRevenue: string;
  vendorEarnings: string;
  refunds: string;
  refundCount: number;
  activeCustomers: number;
  activeVendors: number;
  pendingApplications: number;
  pendingProducts: number;
  series: { date: string; revenue: string; orders: number }[];
  topProducts: { name: string; quantity: number; revenue: string }[];
  topVendors: { store: { name: string; slug: string }; orders: number; sales: string; commission: string; earnings: string }[];
  recentOrders?: { orderNumber: string; status: string; total: string; customer: string; createdAt: string }[];
};

export function AdminHome() {
  usePageTitle("Admin");
  const overview = useQuery({ queryKey: ["admin-overview"], queryFn: () => api<Overview>("/admin/overview") });
  if (overview.error) return <ErrorNote error={overview.error} />;
  const data = overview.data?.data;
  if (!data) return <p className="text-sm">Loading…</p>;
  return (
    <div>
      <h1 className="font-display text-4xl">Marketplace</h1>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {[
          ["GMV", money(data.gmv)],
          ["Gross sales", money(data.grossSales)],
          ["Platform revenue", money(data.platformRevenue)],
          ["Vendor earnings", money(data.vendorEarnings)],
          ["Orders", String(data.orders)],
          ["AOV", money(data.averageOrderValue)],
          ["Customers", String(data.activeCustomers)],
          ["Vendors", String(data.activeVendors)],
          ["Applications", String(data.pendingApplications)],
          ["Product queue", String(data.pendingProducts)],
          ["Refunds", money(data.refunds)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-card p-3"><p className="text-xs text-muted">{label}</p><p className="font-display text-2xl">{value}</p></div>
        ))}
      </div>
      <div className="mt-6 h-56 rounded-lg border border-line bg-card p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.series.map((row) => ({ ...row, revenue: Number(row.revenue) }))}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="revenue" fill="#2f3faa" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <h2 className="mt-6 font-display text-2xl">Latest orders</h2>
      <ul className="mt-2 text-sm">{data.recentOrders?.map((order) => <li key={order.orderNumber}><Link to={`/admin/orders/${order.orderNumber}`}>{order.orderNumber}</Link> · {order.customer} · {money(order.total)} · {order.status}</li>)}</ul>
    </div>
  );
}

export function AdminUsers({ role }: { role?: string }) {
  usePageTitle(role === "CUSTOMER" ? "Customers" : "Users");
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const users = useQuery({ queryKey: ["admin-users", role, q], queryFn: () => api<{ id: string; email: string; role: string; status: string; firstName: string; lastName: string }[]>(`/admin/users?${new URLSearchParams({ ...(role ? { role } : {}), ...(q ? { q } : {}) })}`) });
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: (input: { id: string; action: string }) => api(`/admin/users/${input.id}/${input.action}`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  return (
    <div>
      <h1 className="font-display text-4xl">{role === "CUSTOMER" ? "Customers" : "Users"}</h1>
      <input className={`${controlClass} mt-3 max-w-xs`} placeholder="Search" value={q} onChange={(event) => setParams(event.target.value ? { q: event.target.value } : {})} />
      <ul className="mt-4 text-sm">
        {users.data?.data.map((user) => (
          <li key={user.id} className="flex flex-wrap items-center gap-3 border-b border-line py-2">
            <span>{user.firstName} {user.lastName}</span>
            <span className="text-muted">{user.email}</span>
            <StatusBadge value={user.role} />
            <StatusBadge value={user.status} />
            {user.status === "ACTIVE" ? <button type="button" onClick={() => act.mutate({ id: user.id, action: "suspend" })}>Suspend</button> : <button type="button" onClick={() => act.mutate({ id: user.id, action: "activate" })}>Activate</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

type VendorRow = { id: string; name: string; email: string; status: string; store: { id: string; name: string; slug: string; status: string; commissionRate: string | null } | null };

export function AdminVendors() {
  usePageTitle("Vendors");
  const vendors = useQuery({ queryKey: ["admin-vendors"], queryFn: () => api<VendorRow[]>("/admin/vendors") });
  const queryClient = useQueryClient();
  const toast = useSession((state) => state.toast);
  const act = useMutation({
    mutationFn: (input: { id: string; path: string; body?: unknown }) => api(`/admin/vendors/${input.id}/${input.path}`, { method: "POST", body: input.body ? JSON.stringify(input.body) : undefined }),
    onSuccess: (result) => {
      toast(result.message);
      void queryClient.invalidateQueries({ queryKey: ["admin-vendors"] });
    },
    onError: (error) => toast(error.message),
  });
  return (
    <div>
      <h1 className="font-display text-4xl">Vendors</h1>
      <ul className="mt-4 space-y-3 text-sm">
        {vendors.data?.data.map((vendor) => (
          <li key={vendor.id} className="rounded-lg border border-line bg-card p-3">
            <p className="font-medium">{vendor.store?.name || vendor.name} · {vendor.email}</p>
            <p className="text-muted">{vendor.status}{vendor.store ? ` · commission ${vendor.store.commissionRate ?? "default"}` : ""}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {vendor.status === "PENDING" ? <Button onClick={() => act.mutate({ id: vendor.id, path: "approve" })}>Approve</Button> : null}
              {vendor.status === "PENDING" ? <Button variant="ghost" onClick={() => act.mutate({ id: vendor.id, path: "reject", body: { reason: "Not a fit for the current edit." } })}>Reject</Button> : null}
              {vendor.status === "APPROVED" ? <Button variant="ghost" onClick={() => act.mutate({ id: vendor.id, path: "suspend" })}>Suspend</Button> : null}
              {vendor.status === "SUSPENDED" ? <Button onClick={() => act.mutate({ id: vendor.id, path: "activate" })}>Activate</Button> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminApplications() {
  usePageTitle("Applications");
  const applications = useQuery({ queryKey: ["applications"], queryFn: () => api<{ id: string; storeName: string; status: string; description: string; city: string | null; user: { email: string } }[]>("/admin/applications?status=PENDING") });
  return (
    <div>
      <h1 className="font-display text-4xl">Applications</h1>
      <p className="mt-2 text-sm text-muted">Approve or reject from the vendor list. This queue is the pending applications.</p>
      <ul className="mt-4 space-y-3 text-sm">{applications.data?.data.map((item) => <li key={item.id} className="rounded-lg border border-line bg-card p-3"><p className="font-medium">{item.storeName}</p><p>{item.user.email} · {item.city}</p><p className="text-muted">{item.description}</p></li>)}</ul>
    </div>
  );
}

export function AdminProducts() {
  usePageTitle("Products");
  const [status, setStatus] = useState("PENDING_APPROVAL");
  const products = useQuery({ queryKey: ["admin-products", status], queryFn: () => api<{ id: string; name: string; sku: string; status: string; price: string; store: string; rejectionReason: string | null }[]>(`/admin/products?status=${status}`) });
  const queryClient = useQueryClient();
  const toast = useSession((state) => state.toast);
  const act = useMutation({
    mutationFn: (input: { id: string; path: string; body?: unknown }) => api(`/admin/products/${input.id}/${input.path}`, { method: "POST", body: input.body ? JSON.stringify(input.body) : "{}" }),
    onSuccess: (result) => {
      toast(result.message);
      void queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    },
  });
  return (
    <div>
      <h1 className="font-display text-4xl">Products</h1>
      <select className={`${controlClass} mt-3 max-w-xs`} value={status} onChange={(event) => setStatus(event.target.value)}>
        {["PENDING_APPROVAL", "APPROVED", "DRAFT", "REJECTED", "ARCHIVED"].map((item) => <option key={item}>{item}</option>)}
      </select>
      <ul className="mt-4 text-sm">
        {products.data?.data.map((product) => (
          <li key={product.id} className="flex flex-wrap items-center gap-3 border-b border-line py-2">
            <span>{product.name}</span><span className="text-muted">{product.store}</span><StatusBadge value={product.status} /><span>{money(product.price)}</span>
            {product.status === "PENDING_APPROVAL" ? <Button onClick={() => act.mutate({ id: product.id, path: "approve" })}>Approve</Button> : null}
            {product.status === "PENDING_APPROVAL" ? <Button variant="ghost" onClick={() => act.mutate({ id: product.id, path: "reject", body: { reason: "Needs a clearer description." } })}>Reject</Button> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminCategories() {
  usePageTitle("Categories");
  const categories = useQuery({ queryKey: ["admin-categories"], queryFn: () => api<{ id: string; name: string; slug: string; commissionRate: string | null; isActive: boolean }[]>("/admin/categories") });
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", description: "" });
  const create = useMutation({
    mutationFn: () => api("/admin/categories", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-categories"] }),
  });
  return (
    <div>
      <h1 className="font-display text-4xl">Categories</h1>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <input className={controlClass} placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input className={controlClass} placeholder="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        <Button type="submit">Add</Button>
      </form>
      <ul className="mt-4 text-sm">{categories.data?.data.map((category) => <li key={category.id}>{category.name} · {category.slug} · {category.commissionRate ?? "default"} · {category.isActive ? "active" : "hidden"}</li>)}</ul>
    </div>
  );
}

export function AdminOrders() {
  usePageTitle("Orders");
  const orders = useQuery({ queryKey: ["admin-orders"], queryFn: () => api<{ orderNumber: string; status: string; grandTotal: string; createdAt: string }[]>("/admin/orders") });
  return (
    <div>
      <h1 className="font-display text-4xl">Orders</h1>
      <ul className="mt-4 text-sm">{orders.data?.data.map((order) => <li key={order.orderNumber} className="flex gap-3 border-b border-line py-2"><Link to={`/admin/orders/${order.orderNumber}`}>{order.orderNumber}</Link><StatusBadge value={order.status} /><span>{money(order.grandTotal)}</span></li>)}</ul>
    </div>
  );
}

export function AdminOrderDetail() {
  const { orderNumber = "" } = useParams();
  usePageTitle(orderNumber);
  const order = useQuery({ queryKey: ["admin-order", orderNumber], queryFn: () => api<{ orderNumber: string; status: string; grandTotal: string; customer: { name: string; email: string }; vendorOrders: { id: string; orderNumber: string; status: string; store: { name: string }; commission?: string; vendorEarnings?: string; items: { name: string; quantity: number }[] }[]; commissions: { amount: string; rate: string; vendorOrderNumber: string; store?: string }[] }>("/admin/orders/" + orderNumber) });
  const toast = useSession((state) => state.toast);
  const queryClient = useQueryClient();
  const refund = useMutation({
    mutationFn: (vendorOrderId: string) => api("/admin/refunds", { method: "POST", body: JSON.stringify({ vendorOrderId, reason: "Admin refund", restock: true }) }),
    onSuccess: (result) => {
      toast(result.message);
      void queryClient.invalidateQueries({ queryKey: ["admin-order", orderNumber] });
    },
    onError: (error) => toast(error.message),
  });
  const data = order.data?.data;
  if (!data) return <p className="text-sm">Loading…</p>;
  return (
    <div>
      <h1 className="font-display text-4xl" data-testid="admin-order">{data.orderNumber}</h1>
      <p className="text-sm">{data.customer.name} · {data.customer.email} · {money(data.grandTotal)}</p>
      <StatusBadge value={data.status} />
      {data.vendorOrders.map((vendorOrder) => (
        <section key={vendorOrder.id} className="mt-4 rounded-lg border border-line bg-card p-3 text-sm" data-testid="admin-suborder">
          <p className="font-medium">{vendorOrder.store.name} · {vendorOrder.orderNumber}</p>
          <p>{vendorOrder.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}</p>
          <p>Commission {vendorOrder.commission ? money(vendorOrder.commission) : "—"} · Earnings {vendorOrder.vendorEarnings ? money(vendorOrder.vendorEarnings) : "—"}</p>
          <Button variant="ghost" className="mt-2" onClick={() => refund.mutate(vendorOrder.id)}>Refund this studio</Button>
        </section>
      ))}
    </div>
  );
}

function SimpleList({ title, path, render }: { title: string; path: string; render: (row: Record<string, unknown>) => string }) {
  usePageTitle(title);
  const rows = useQuery({ queryKey: [path], queryFn: () => api<Record<string, unknown>[]>(path) });
  return (
    <div>
      <h1 className="font-display text-4xl">{title}</h1>
      <ul className="mt-4 text-sm">{(rows.data?.data || []).map((row, index) => <li key={String(row.id || index)} className="border-b border-line py-2">{render(row)}</li>)}</ul>
    </div>
  );
}

export function AdminPayments() {
  return <SimpleList title="Payments" path="/admin/payments" render={(row) => `${row.orderNumber} · ${row.status} · ${money(String(row.amount))} · ${row.provider}`} />;
}
export function AdminTransactions() {
  return <SimpleList title="Transactions" path="/admin/transactions" render={(row) => `${row.orderNumber} · ${row.type} · ${money(String(row.amount))} · ${row.status}`} />;
}
export function AdminCommissions() {
  return <SimpleList title="Commissions" path="/admin/commissions" render={(row) => `${row.store} · ${row.vendorOrderNumber} · ${row.rate}% of ${money(String(row.baseAmount))} = ${money(String(row.amount))}`} />;
}
export function AdminPayouts() {
  const payouts = useQuery({ queryKey: ["admin-payouts"], queryFn: () => api<{ id: string; amount: string; status: string; store: string }[]>("/admin/payouts") });
  const stores = useQuery({ queryKey: ["admin-vendors"], queryFn: () => api<{ store: { id: string; name: string } | null }[]>("/admin/vendors") });
  const queryClient = useQueryClient();
  const toast = useSession((state) => state.toast);
  const [storeId, setStoreId] = useState("");
  const [amount, setAmount] = useState("10.00");
  const create = useMutation({
    mutationFn: () => api("/admin/payouts", { method: "POST", body: JSON.stringify({ storeId, amount }) }),
    onSuccess: (result) => {
      toast(result.message);
      void queryClient.invalidateQueries({ queryKey: ["admin-payouts"] });
    },
    onError: (error) => toast(error.message),
  });
  const status = useMutation({
    mutationFn: (input: { id: string; status: string }) => api(`/admin/payouts/${input.id}/status`, { method: "POST", body: JSON.stringify({ status: input.status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-payouts"] }),
  });
  usePageTitle("Payouts");
  return (
    <div>
      <h1 className="font-display text-4xl">Payouts</h1>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <select className={controlClass} value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          <option value="">Store</option>
          {stores.data?.data.filter((vendor) => vendor.store).map((vendor) => <option key={vendor.store!.id} value={vendor.store!.id}>{vendor.store!.name}</option>)}
        </select>
        <input className="w-28 rounded-md border border-line px-2" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <Button type="submit">Create payout</Button>
      </form>
      <ul className="mt-4 text-sm">
        {payouts.data?.data.map((payout) => (
          <li key={payout.id} className="flex flex-wrap items-center gap-3 border-b border-line py-2">
            {payout.store} · {money(payout.amount)} <StatusBadge value={payout.status} />
            {payout.status === "PENDING" ? <button type="button" onClick={() => status.mutate({ id: payout.id, status: "PROCESSING" })}>Processing</button> : null}
            {payout.status === "PROCESSING" || payout.status === "PENDING" ? <button type="button" onClick={() => status.mutate({ id: payout.id, status: "PAID" })}>Mark paid</button> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
export function AdminRefunds() {
  return <SimpleList title="Refunds" path="/admin/refunds" render={(row) => `${row.orderNumber} · ${row.store || ""} · ${money(String(row.amount))} · ${row.reason}`} />;
}
export function AdminCoupons() {
  usePageTitle("Coupons");
  const coupons = useQuery({ queryKey: ["admin-coupons"], queryFn: () => api<{ id: string; code: string; type: string; value: string; active: boolean; store: string; usages: number }[]>("/admin/coupons") });
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const create = useMutation({
    mutationFn: () => api("/admin/coupons", { method: "POST", body: JSON.stringify({ code, type: "PERCENTAGE", value: "10.00", description: "Platform offer" }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-coupons"] }),
  });
  const toggle = useMutation({
    mutationFn: (input: { id: string; active: boolean }) => api(`/admin/coupons/${input.id}`, { method: "PATCH", body: JSON.stringify({ active: input.active }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-coupons"] }),
  });
  return (
    <div>
      <h1 className="font-display text-4xl">Coupons</h1>
      <form className="mt-3 flex gap-2" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}>
        <input className={controlClass} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Code" />
        <Button type="submit">Create 10%</Button>
      </form>
      <ul className="mt-4 text-sm">{coupons.data?.data.map((coupon) => <li key={coupon.id} className="flex gap-3 border-b border-line py-2">{coupon.code} · {coupon.store} · {coupon.usages} uses <button type="button" onClick={() => toggle.mutate({ id: coupon.id, active: !coupon.active })}>{coupon.active ? "Pause" : "Activate"}</button></li>)}</ul>
    </div>
  );
}
export function AdminReviews() {
  usePageTitle("Reviews");
  const reviews = useQuery({ queryKey: ["admin-reviews"], queryFn: () => api<{ id: string; title: string; status: string; product: string; author: string; rating: number }[]>("/admin/reviews") });
  const queryClient = useQueryClient();
  const moderate = useMutation({
    mutationFn: (input: { id: string; status: string }) => api(`/admin/reviews/${input.id}/moderate`, { method: "POST", body: JSON.stringify({ status: input.status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-reviews"] }),
  });
  return (
    <div>
      <h1 className="font-display text-4xl">Reviews</h1>
      <ul className="mt-4 space-y-2 text-sm">
        {reviews.data?.data.map((review) => (
          <li key={review.id} className="rounded-md border border-line bg-card p-3">
            {review.product} · {review.rating}★ · {review.author} · {review.title} <StatusBadge value={review.status} />
            {review.status === "PENDING" ? <span className="ml-2"><button type="button" onClick={() => moderate.mutate({ id: review.id, status: "APPROVED" })}>Approve</button> <button type="button" onClick={() => moderate.mutate({ id: review.id, status: "REJECTED" })}>Reject</button></span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
export function AdminReports() {
  usePageTitle("Reports");
  const report = useQuery({ queryKey: ["sales-report"], queryFn: () => api<Overview & { categories: { name: string; revenue: string; quantity: number }[] }>("/admin/reports/sales") });
  return (
    <div>
      <h1 className="font-display text-4xl">Reports</h1>
      <a className="text-sm text-accent" href="/api/v1/admin/reports/sales?format=csv">The CSV export needs the admin session from the API directly. The table below is the same report.</a>
      <ul className="mt-4 text-sm">{report.data?.data.categories.map((row) => <li key={row.name}>{row.name} · {money(row.revenue)} · {row.quantity} units</li>)}</ul>
    </div>
  );
}
export function AdminAnalytics() {
  usePageTitle("Analytics");
  const analytics = useQuery({ queryKey: ["admin-analytics"], queryFn: () => api<Overview>("/admin/analytics") });
  const data = analytics.data?.data;
  return (
    <div>
      <h1 className="font-display text-4xl">Analytics</h1>
      <h2 className="mt-4 font-medium">Top products</h2>
      <ul className="text-sm">{data?.topProducts.map((item) => <li key={item.name}>{item.name} · {item.quantity} · {money(item.revenue)}</li>)}</ul>
      <h2 className="mt-4 font-medium">Top studios</h2>
      <ul className="text-sm">{data?.topVendors.map((item) => <li key={item.store.slug}>{item.store.name} · sales {money(item.sales)} · commission {money(item.commission)} · earnings {money(item.earnings)}</li>)}</ul>
    </div>
  );
}
export function AdminSearch() {
  usePageTitle("Search");
  const search = useQuery({ queryKey: ["search-admin"], queryFn: () => api<{ engine: string; elasticsearchConfigured: boolean }>("/admin/search") });
  const queryClient = useQueryClient();
  const reindex = useMutation({
    mutationFn: () => api("/admin/search/reindex", { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["search-admin"] }),
  });
  return (
    <div>
      <h1 className="font-display text-4xl">Search</h1>
      <p className="mt-2 text-sm">Engine: {search.data?.data.engine}. Elasticsearch configured: {search.data?.data.elasticsearchConfigured ? "yes" : "no"}. PostgreSQL search is used when Elasticsearch is absent or unreachable.</p>
      <Button className="mt-4" onClick={() => reindex.mutate()}>Reindex</Button>
    </div>
  );
}
export function AdminSettings() {
  usePageTitle("Settings");
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Record<string, unknown>>("/admin/settings") });
  const toast = useSession((state) => state.toast);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const current = draft || settings.data?.data || null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    const result = await api("/admin/settings", { method: "PUT", body: JSON.stringify(current) });
    toast(result.message);
  }
  if (!current) return <p className="text-sm">Loading…</p>;
  const fields = ["marketplace_name", "announcement", "support_email", "default_commission_rate", "tax_rate", "free_shipping_threshold", "standard_shipping", "express_shipping"] as const;
  const flags = ["vendor_approval_required", "product_approval_required", "maintenance_mode", "review_moderation_required", "require_verified_email"] as const;
  return (
    <form className="grid max-w-lg gap-3" onSubmit={submit}>
      <h1 className="font-display text-4xl">Settings</h1>
      {fields.map((key) => (
        <label key={key} className="text-sm">{key}
          <input className={controlClass} value={String(current[key] ?? "")} onChange={(event) => setDraft({ ...current, [key]: event.target.value })} />
        </label>
      ))}
      {flags.map((key) => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(current[key])} onChange={(event) => setDraft({ ...current, [key]: event.target.checked })} />
          {key}
        </label>
      ))}
      <Button type="submit">Save settings</Button>
    </form>
  );
}
export function AdminAudit() {
  return <SimpleList title="Audit log" path="/admin/audit" render={(row) => `${row.createdAt} · ${row.actor} · ${row.action} · ${row.entity}`} />;
}
