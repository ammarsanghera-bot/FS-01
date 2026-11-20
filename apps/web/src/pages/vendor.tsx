import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardLayout, usePageTitle } from "../components/chrome";
import { Button, Empty, ErrorNote, StatusBadge, controlClass } from "../components/ui";
import { api } from "../lib/api";
import { money, vendorNextStatus } from "../lib/catalog";
import { useSession } from "../stores/session";

export const vendorLinks = [
  { to: "/vendor", label: "Overview" },
  { to: "/vendor/products", label: "Products" },
  { to: "/vendor/products/new", label: "Add product" },
  { to: "/vendor/inventory", label: "Inventory" },
  { to: "/vendor/orders", label: "Orders" },
  { to: "/vendor/customers", label: "Customers" },
  { to: "/vendor/coupons", label: "Coupons" },
  { to: "/vendor/reviews", label: "Reviews" },
  { to: "/vendor/store", label: "Store settings" },
  { to: "/vendor/earnings", label: "Earnings" },
  { to: "/vendor/payouts", label: "Payouts" },
  { to: "/vendor/analytics", label: "Analytics" },
  { to: "/vendor/profile", label: "Profile" },
];

export function VendorLayout() {
  const user = useSession((state) => state.user);
  if (user && user.vendorStatus !== "APPROVED") return <PendingVendor />;
  return <DashboardLayout title={user?.store?.name || "Studio"} links={vendorLinks} />;
}

function PendingVendor() {
  usePageTitle("Application");
  const application = useQuery({ queryKey: ["vendor-application"], queryFn: () => api<{ application: { status: string; storeName: string; rejectionReason?: string | null } | null; vendorStatus: string | null }>("/vendor/application") });
  const data = application.data?.data;
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="font-display text-4xl">Application in review</h1>
      <p className="mt-3 text-muted">
        {data?.application?.storeName || "Your studio"} is {data?.vendorStatus?.toLowerCase() || "pending"}. The shop stays closed until an admin approves it.
      </p>
      {data?.application?.rejectionReason ? <p className="mt-3 text-sm">{data.application.rejectionReason}</p> : null}
      <Link to="/" className="mt-6 inline-block text-sm text-accent">Back to the market</Link>
    </div>
  );
}

type Overview = {
  store: { name: string };
  overview: { sales: string; orders: number; pendingOrders: number; products: number; lowStock: number; commission: string; netEarnings: string; series: { date: string; revenue: string; orders: number }[]; bestSellers: { name: string; quantity: number; revenue: string }[] };
  balance: { available: string; reserved: string; ledger: string };
  recentOrders: VendorOrder[];
};

export function VendorHome() {
  usePageTitle("Studio");
  const overview = useQuery({ queryKey: ["vendor-overview"], queryFn: () => api<Overview>("/vendor/overview") });
  if (overview.isLoading) return <p className="text-sm text-muted">Loading the studio…</p>;
  if (overview.error || !overview.data) return <ErrorNote error={overview.error} />;
  const data = overview.data.data;
  return (
    <div>
      <h1 className="font-display text-4xl">{data.store.name}</h1>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Stat label="Sales" value={money(data.overview.sales)} />
        <Stat label="Orders" value={String(data.overview.orders)} />
        <Stat label="Pending" value={String(data.overview.pendingOrders)} />
        <Stat label="Net earnings" value={money(data.overview.netEarnings)} />
        <Stat label="Commission" value={money(data.overview.commission)} />
        <Stat label="Available" value={money(data.balance.available)} />
        <Stat label="Products" value={String(data.overview.products)} />
        <Stat label="Low stock" value={String(data.overview.lowStock)} />
      </div>
      <Chart series={data.overview.series} />
      <h2 className="mt-8 font-display text-2xl">Recent orders</h2>
      <OrderTable orders={data.recentOrders} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-line bg-card p-3"><p className="text-xs text-muted">{label}</p><p className="font-display text-2xl">{value}</p></div>;
}

function Chart({ series }: { series: { date: string; revenue: string }[] }) {
  const rows = series.map((row) => ({ ...row, revenue: Number(row.revenue) }));
  if (!rows.length) return null;
  return (
    <div className="mt-6 h-56 rounded-lg border border-line bg-card p-3">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="revenue" fill="#2f3faa" radius={3} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type VendorOrder = {
  id: string;
  orderNumber: string;
  parentOrderNumber: string;
  status: string;
  subtotal: string;
  commission: string;
  vendorEarnings: string;
  createdAt: string;
  customer: { name: string; email: string };
  shippingAddress: { fullName?: string; line1?: string; city?: string; state?: string; postalCode?: string };
  items: { id: string; name: string; sku: string; quantity: number; lineTotal: string }[];
  shipments: { carrier: string; trackingNumber: string; status: string }[];
};

function OrderTable({ orders }: { orders: VendorOrder[] }) {
  if (!orders.length) return <Empty title="No orders" body="Paid orders for your studio land here." />;
  return (
    <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-card text-sm">
      {orders.map((order) => (
        <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid="vendor-order">
          <Link to={`/vendor/orders/${order.id}`} className="font-medium">{order.orderNumber}</Link>
          <span>{order.customer.name}</span>
          <span className="text-muted">{order.items.map((item) => item.name).join(", ")}</span>
          <StatusBadge value={order.status} />
          <span>{money(order.vendorEarnings)}</span>
        </li>
      ))}
    </ul>
  );
}

export function VendorOrders() {
  usePageTitle("Studio orders");
  const orders = useQuery({ queryKey: ["vendor-orders"], queryFn: () => api<VendorOrder[]>("/vendor/orders") });
  return <div><h1 className="font-display text-4xl">Orders</h1><OrderTable orders={orders.data?.data || []} /></div>;
}

export function VendorOrderDetail() {
  const { id = "" } = useParams();
  usePageTitle("Order");
  const queryClient = useQueryClient();
  const toast = useSession((state) => state.toast);
  const order = useQuery({ queryKey: ["vendor-order", id], queryFn: () => api<VendorOrder>(`/vendor/orders/${id}`) });
  const [carrier, setCarrier] = useState("USPS");
  const [tracking, setTracking] = useState("");
  const update = useMutation({
    mutationFn: (status: string) => api(`/vendor/orders/${id}/status`, { method: "POST", body: JSON.stringify({ status, carrier, trackingNumber: tracking }) }),
    onSuccess: (result) => {
      toast(result.message);
      void queryClient.invalidateQueries({ queryKey: ["vendor-order", id] });
    },
    onError: (error) => toast(error.message),
  });
  if (order.isLoading) return <p className="text-sm">Loading…</p>;
  if (order.error || !order.data) return <ErrorNote error={order.error} />;
  const data = order.data.data;
  const next = vendorNextStatus[data.status] || [];
  return (
    <div>
      <h1 className="font-display text-4xl">{data.orderNumber}</h1>
      <p className="text-sm text-muted">Parent {data.parentOrderNumber} · {data.customer.name} · {data.customer.email}</p>
      <div className="mt-2"><StatusBadge value={data.status} /></div>
      <p className="mt-3 text-sm">{data.shippingAddress.fullName}, {data.shippingAddress.line1}, {data.shippingAddress.city} {data.shippingAddress.state} {data.shippingAddress.postalCode}</p>
      <ul className="mt-4 text-sm">
        {data.items.map((item) => <li key={item.id} data-testid="vendor-item">{item.name} · {item.sku} × {item.quantity}</li>)}
      </ul>
      <p className="mt-3 text-sm">Commission {money(data.commission)} · Earnings {money(data.vendorEarnings)}</p>
      {data.shipments.map((shipment) => <p key={shipment.trackingNumber} className="text-sm">{shipment.carrier} {shipment.trackingNumber}</p>)}
      {next.includes("SHIPPED") ? (
        <div className="mt-4 grid max-w-sm gap-2">
          <input className={controlClass} value={carrier} onChange={(event) => setCarrier(event.target.value)} aria-label="Carrier" />
          <input className={controlClass} value={tracking} onChange={(event) => setTracking(event.target.value)} placeholder="Tracking number" aria-label="Tracking number" />
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {next.map((status) => <Button key={status} data-testid={`status-${status}`} onClick={() => update.mutate(status)}>{status === "CANCELLED" ? "Cancel and refund" : status.toLowerCase()}</Button>)}
      </div>
    </div>
  );
}

type OwnedProduct = { id: string; name: string; sku: string; status: string; price: string; image: string | null };

export function VendorProducts() {
  usePageTitle("Products");
  const products = useQuery({ queryKey: ["vendor-products"], queryFn: () => api<OwnedProduct[]>("/vendor/products") });
  const queryClient = useQueryClient();
  const archive = useMutation({
    mutationFn: (id: string) => api(`/vendor/products/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["vendor-products"] }),
  });
  const submit = useMutation({
    mutationFn: (id: string) => api(`/vendor/products/${id}/submit`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["vendor-products"] }),
  });
  return (
    <div>
      <div className="flex items-center justify-between"><h1 className="font-display text-4xl">Products</h1><Link to="/vendor/products/new" className="text-sm text-accent">Add product</Link></div>
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-card text-sm">
        {(products.data?.data || []).map((product) => (
          <li key={product.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <Link to={`/vendor/products/${product.id}`}>{product.name}</Link>
            <span>{product.sku}</span>
            <StatusBadge value={product.status} />
            <span>{money(product.price)}</span>
            {product.status === "DRAFT" || product.status === "REJECTED" ? <button type="button" onClick={() => submit.mutate(product.id)}>Submit</button> : null}
            <button type="button" className="text-muted" onClick={() => archive.mutate(product.id)}>Archive</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VendorProductForm() {
  const { id } = useParams();
  usePageTitle(id ? "Edit product" : "Add product");
  const existing = useQuery({
    queryKey: ["vendor-product", id],
    enabled: Boolean(id),
    queryFn: () => api<{ name: string; shortDescription: string; description: string; categoryId: string; price: string; sku: string; tags: string[]; variants: { id: string; sku: string; quantity: number; options: Record<string, string> }[]; images: { url: string; alt: string | null }[] }>(`/vendor/products/${id}`),
  });
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<{ id: string; name: string }[]>("/categories") });
  const toast = useSession((state) => state.toast);
  const loaded = existing.data?.data;
  const [form, setForm] = useState({ name: "", shortDescription: "", description: "", categoryId: "", price: "", sku: "", tags: "", image: "" });
  const [variants, setVariants] = useState<{ id?: string; sku: string; quantity: number; options: Record<string, string> }[]>([{ sku: "", quantity: 5, options: { Option: "One" } }]);
  useEffect(() => {
    if (!loaded) return;
    setForm({
      name: loaded.name,
      shortDescription: loaded.shortDescription,
      description: loaded.description,
      categoryId: loaded.categoryId,
      price: loaded.price,
      sku: loaded.sku,
      tags: (loaded.tags || []).join(", "),
      image: loaded.images[0]?.url || "",
    });
    setVariants(loaded.variants.map((variant) => ({ id: variant.id, sku: variant.sku, quantity: variant.quantity, options: variant.options || {} })));
  }, [loaded]);
  async function upload(file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await api<{ url: string }>("/uploads", { method: "POST", body });
    setForm((current) => ({ ...current, image: result.data.url }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const kept = (loaded?.images || []).map((image) => ({ url: image.url, alt: image.alt || form.name }));
    const images = form.image && !kept.some((image) => image.url === form.image) ? [{ url: form.image, alt: form.name }, ...kept] : kept.length ? kept : form.image ? [{ url: form.image, alt: form.name }] : [];
    const payload = {
      name: form.name,
      shortDescription: form.shortDescription,
      description: form.description,
      categoryId: form.categoryId,
      price: form.price,
      sku: form.sku,
      tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      images,
      variants: variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        name: Object.values(variant.options).join(" / ") || "Default",
        options: Object.keys(variant.options).length ? variant.options : { Option: "One" },
        quantity: Number(variant.quantity),
      })),
      submit: true,
    };
    const result = id
      ? await api(`/vendor/products/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
      : await api("/vendor/products", { method: "POST", body: JSON.stringify(payload) });
    toast(result.message);
  }
  return (
    <form className="grid max-w-xl gap-3" onSubmit={submit}>
      <h1 className="font-display text-4xl">{id ? "Edit product" : "Add product"}</h1>
      <input required className={controlClass} placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      <input required className={controlClass} placeholder="Short description" value={form.shortDescription} onChange={(event) => setForm({ ...form, shortDescription: event.target.value })} />
      <textarea required className={controlClass} rows={4} placeholder="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
      <select required className={controlClass} value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
        <option value="">Category</option>
        {categories.data?.data.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select>
      <input required className={controlClass} placeholder="Price" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
      <input required className={controlClass} placeholder="Product SKU" value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} />
      {variants.map((variant, index) => (
        <div key={variant.id || index} className="grid grid-cols-[1fr_6rem] gap-2">
          <input required className={controlClass} placeholder="Variant SKU" aria-label={`Variant ${index + 1} SKU`} value={variant.sku} onChange={(event) => setVariants(variants.map((item, itemIndex) => itemIndex === index ? { ...item, sku: event.target.value } : item))} />
          <input className={controlClass} type="number" min={0} aria-label={`Variant ${index + 1} quantity`} value={variant.quantity} onChange={(event) => setVariants(variants.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item))} />
        </div>
      ))}
      <button type="button" className="text-left text-sm text-accent" onClick={() => setVariants([...variants, { sku: "", quantity: 0, options: { Option: "One" } }])}>Add variant</button>
      <input className={controlClass} placeholder="Tags, comma separated" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} />
      <input className={controlClass} placeholder="Image URL" value={form.image} onChange={(event) => setForm({ ...form, image: event.target.value })} />
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
      <Button type="submit">Save and submit</Button>
    </form>
  );
}

export function InventoryPage() {
  usePageTitle("Inventory");
  const rows = useQuery({ queryKey: ["inventory"], queryFn: () => api<{ variantId: string; sku: string; product: string; quantity: number; reserved: number; available: number; lowStockThreshold: number }[]>("/vendor/inventory") });
  const queryClient = useQueryClient();
  const toast = useSession((state) => state.toast);
  const [delta, setDelta] = useState<Record<string, string>>({});
  const adjust = useMutation({
    mutationFn: (variantId: string) => api(`/vendor/inventory/${variantId}/adjust`, { method: "POST", body: JSON.stringify({ delta: Number(delta[variantId] || 0), reason: "Studio count" }) }),
    onSuccess: () => {
      toast("Inventory updated");
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (error) => toast(error.message),
  });
  return (
    <div>
      <h1 className="font-display text-4xl">Inventory</h1>
      <table className="mt-4 w-full text-left text-sm">
        <thead className="text-muted"><tr><th>SKU</th><th>Product</th><th>On hand</th><th>Reserved</th><th>Available</th><th></th></tr></thead>
        <tbody>
          {(rows.data?.data || []).map((row) => (
            <tr key={row.variantId} className="border-t border-line">
              <td className="py-2">{row.sku}</td>
              <td>{row.product}</td>
              <td>{row.quantity}</td>
              <td>{row.reserved}</td>
              <td className={row.available <= row.lowStockThreshold ? "text-[#8d3a32]" : ""}>{row.available}</td>
              <td className="flex gap-2 py-2">
                <input className="w-16 rounded-md border border-line px-2" placeholder="+/-" value={delta[row.variantId] || ""} onChange={(event) => setDelta({ ...delta, [row.variantId]: event.target.value })} />
                <button type="button" onClick={() => adjust.mutate(row.variantId)}>Adjust</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VendorCustomers() {
  usePageTitle("Customers");
  const customers = useQuery({ queryKey: ["vendor-customers"], queryFn: () => api<{ name: string; email: string; orders: number; spend: string }[]>("/vendor/customers") });
  return (
    <div>
      <h1 className="font-display text-4xl">Customers</h1>
      <ul className="mt-4 text-sm">{customers.data?.data.map((customer) => <li key={customer.email} className="border-b border-line py-2">{customer.name} · {customer.email} · {customer.orders} orders · {money(customer.spend)}</li>)}</ul>
    </div>
  );
}

export function VendorCoupons() {
  usePageTitle("Coupons");
  const coupons = useQuery({ queryKey: ["vendor-coupons"], queryFn: () => api<{ id: string; code: string; type: string; value: string; active: boolean }[]>("/vendor/coupons") });
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const create = useMutation({
    mutationFn: () => api("/vendor/coupons", { method: "POST", body: JSON.stringify({ code, type: "PERCENTAGE", value: "10.00", description: "Studio offer" }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["vendor-coupons"] }),
  });
  return (
    <div>
      <h1 className="font-display text-4xl">Coupons</h1>
      <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <input className={controlClass} placeholder="Code" value={code} onChange={(event) => setCode(event.target.value)} />
        <Button type="submit">Create 10%</Button>
      </form>
      {create.error ? <ErrorNote error={create.error} /> : null}
      <ul className="mt-4 text-sm">{coupons.data?.data.map((coupon) => <li key={coupon.id}>{coupon.code} · {coupon.type} · {coupon.value} · {coupon.active ? "active" : "off"}</li>)}</ul>
    </div>
  );
}

export function VendorReviews() {
  usePageTitle("Reviews");
  const reviews = useQuery({ queryKey: ["vendor-reviews"], queryFn: () => api<{ id: string; title: string; body: string; rating: number; author: string; product: { name: string }; vendorResponse: string | null }[]>("/vendor/reviews") });
  const queryClient = useQueryClient();
  const [text, setText] = useState<Record<string, string>>({});
  const respond = useMutation({
    mutationFn: (id: string) => api(`/vendor/reviews/${id}/respond`, { method: "POST", body: JSON.stringify({ response: text[id] }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["vendor-reviews"] }),
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-4xl">Reviews</h1>
      {(reviews.data?.data || []).map((review) => (
        <article key={review.id} className="rounded-lg border border-line bg-card p-3 text-sm">
          <p className="font-medium">{review.product.name} · {review.rating}★ · {review.author}</p>
          <p>{review.title}</p>
          <p className="text-muted">{review.body}</p>
          {review.vendorResponse ? <p className="mt-2">Your reply: {review.vendorResponse}</p> : (
            <div className="mt-2 flex gap-2">
              <input className={controlClass} value={text[review.id] || ""} onChange={(event) => setText({ ...text, [review.id]: event.target.value })} placeholder="Reply" />
              <Button variant="ghost" onClick={() => respond.mutate(review.id)}>Reply</Button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export function StoreSettings() {
  usePageTitle("Store settings");
  const store = useQuery({ queryKey: ["vendor-store"], queryFn: () => api<{ name: string; description: string; city: string | null; region: string | null; returnPolicy: string | null; shippingPolicy: string | null; logoUrl: string | null; coverUrl: string | null }>("/vendor/store") });
  const toast = useSession((state) => state.toast);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const data = store.data?.data;
  const current = form || (data ? { name: data.name, description: data.description, city: data.city || "", region: data.region || "", returnPolicy: data.returnPolicy || "", shippingPolicy: data.shippingPolicy || "", logoUrl: data.logoUrl || "", coverUrl: data.coverUrl || "" } : null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    const result = await api("/vendor/store", { method: "PATCH", body: JSON.stringify(current) });
    toast(result.message);
  }
  if (!current) return <p className="text-sm">Loading…</p>;
  return (
    <form className="grid max-w-xl gap-3" onSubmit={submit}>
      <h1 className="font-display text-4xl">Store settings</h1>
      {Object.entries(current).map(([key, value]) => (
        key === "description" || key === "returnPolicy" || key === "shippingPolicy"
          ? <textarea key={key} className={controlClass} rows={3} value={value} onChange={(event) => setForm({ ...current, [key]: event.target.value })} />
          : <input key={key} className={controlClass} value={value} onChange={(event) => setForm({ ...current, [key]: event.target.value })} />
      ))}
      <Button type="submit">Save store</Button>
    </form>
  );
}

export function EarningsPage() {
  usePageTitle("Earnings");
  const earnings = useQuery({ queryKey: ["earnings"], queryFn: () => api<{ balance: { ledger: string; reserved: string; available: string }; ledger: { id: string; type: string; amount: string; description: string | null; orderNumber: string | null; createdAt: string }[] }>("/vendor/earnings") });
  const data = earnings.data?.data;
  return (
    <div>
      <h1 className="font-display text-4xl">Earnings</h1>
      {data ? <p className="mt-2 text-sm">Ledger {money(data.balance.ledger)} · reserved {money(data.balance.reserved)} · available {money(data.balance.available)}</p> : null}
      <ul className="mt-4 text-sm">{data?.ledger.map((entry) => <li key={entry.id} className="border-b border-line py-2">{entry.type} {money(entry.amount)} {entry.orderNumber || ""} {entry.description || ""}</li>)}</ul>
    </div>
  );
}

export function PayoutsPage() {
  usePageTitle("Payouts");
  const payouts = useQuery({ queryKey: ["vendor-payouts"], queryFn: () => api<{ balance: { available: string }; payouts: { id: string; amount: string; status: string; createdAt: string }[] }>("/vendor/payouts") });
  return (
    <div>
      <h1 className="font-display text-4xl">Payouts</h1>
      <p className="mt-2 text-sm text-muted">Available {payouts.data ? money(payouts.data.data.balance.available) : "—"}. Payouts are created by the platform. An order does not mark funds as paid.</p>
      <ul className="mt-4 text-sm">{payouts.data?.data.payouts.map((payout) => <li key={payout.id} className="flex items-center gap-3 border-b border-line py-2">{money(payout.amount)} <StatusBadge value={payout.status} /></li>)}</ul>
    </div>
  );
}

export function VendorAnalytics() {
  usePageTitle("Analytics");
  const analytics = useQuery({ queryKey: ["vendor-analytics"], queryFn: () => api<Overview["overview"]>("/vendor/analytics") });
  const data = analytics.data?.data;
  return (
    <div>
      <h1 className="font-display text-4xl">Analytics</h1>
      {data ? <Chart series={data.series} /> : null}
      <ul className="mt-4 text-sm">{data?.bestSellers.map((item) => <li key={item.name}>{item.name} · {item.quantity} · {money(item.revenue)}</li>)}</ul>
    </div>
  );
}

export function VendorProfile() {
  usePageTitle("Studio profile");
  const profile = useQuery({ queryKey: ["vendor-profile"], queryFn: () => api<{ legalName: string; status: string; user: { email: string; firstName: string; lastName: string } }>("/vendor/profile") });
  const data = profile.data?.data;
  return (
    <div>
      <h1 className="font-display text-4xl">Profile</h1>
      {data ? <p className="mt-3 text-sm">{data.user.firstName} {data.user.lastName} · {data.user.email} · {data.legalName} · {data.status}</p> : null}
    </div>
  );
}
