import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout, usePageTitle } from "../components/chrome";
import { Button, Empty, ErrorNote, Photo, StatusBadge, controlClass } from "../components/ui";
import { api } from "../lib/api";
import { money } from "../lib/catalog";
import { useSession } from "../stores/session";

export const accountLinks = [
  { to: "/account", label: "Overview" },
  { to: "/account/orders", label: "Orders" },
  { to: "/account/wishlist", label: "Wishlist" },
  { to: "/account/addresses", label: "Addresses" },
  { to: "/account/reviews", label: "Reviews" },
  { to: "/account/profile", label: "Profile" },
];

export function AccountLayout() {
  return <DashboardLayout title="Your account" links={accountLinks} />;
}

export function AccountHome() {
  usePageTitle("Account");
  const user = useSession((state) => state.user);
  const summary = useQuery({ queryKey: ["summary"], queryFn: () => api<{ orders: number; spending: string; wishlist: number }>("/me/summary") });
  const notes = useQuery({ queryKey: ["notes"], queryFn: () => api<{ id: string; title: string; body: string; readAt: string | null }[]>("/notifications") });
  const queryClient = useQueryClient();
  const mark = useMutation({
    mutationFn: () => api("/notifications/read-all", { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notes"] }),
  });
  return (
    <div>
      <h1 className="font-display text-4xl">Hello, {user?.firstName}</h1>
      {!user?.emailVerified ? <p className="mt-2 text-sm text-[#7a5b12]">Your email is not verified yet. You can still shop. Check the development mailbox for the link.</p> : null}
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <Stat label="Orders" value={String(summary.data?.data.orders ?? "—")} />
        <Stat label="Spending" value={summary.data ? money(summary.data.data.spending) : "—"} />
        <Stat label="Saved" value={String(summary.data?.data.wishlist ?? "—")} />
      </div>
      <div className="mt-8 flex items-center justify-between">
        <h2 className="font-display text-2xl">Notifications</h2>
        <button type="button" className="text-sm text-muted" onClick={() => mark.mutate()}>Mark all read</button>
      </div>
      <ul className="mt-3 space-y-2 text-sm">
        {(notes.data?.data || []).map((note) => (
          <li key={note.id} className="rounded-md border border-line bg-card px-3 py-2">
            <p className="font-medium">{note.title}</p>
            <p className="text-muted">{note.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-line bg-card p-4"><p className="text-xs uppercase tracking-wide text-muted">{label}</p><p className="mt-1 font-display text-3xl">{value}</p></div>;
}

type OrderListItem = { orderNumber: string; status: string; grandTotal: string; createdAt: string };

export function OrdersPage() {
  usePageTitle("Orders");
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api<OrderListItem[]>("/orders") });
  if (orders.error) return <ErrorNote error={orders.error} />;
  if (orders.data && orders.data.data.length === 0) return <Empty title="No orders yet" body="When you check out, the parent order and each studio’s shipment show up here." />;
  return (
    <div>
      <h1 className="font-display text-4xl">Orders</h1>
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-card">
        {orders.data?.data.map((order) => (
          <li key={order.orderNumber} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <Link to={`/orders/${order.orderNumber}`} className="font-medium">{order.orderNumber}</Link>
            <StatusBadge value={order.status} />
            <span>{money(order.grandTotal)}</span>
            <span className="text-muted">{new Date(order.createdAt).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WishlistPage() {
  usePageTitle("Wishlist");
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["wishlist"], queryFn: () => api<{ items: { id: string; productId: string; product: { name: string; slug: string; price: string; image: string | null; inStock: boolean; vendor: { name: string } } }[] }>("/wishlist") });
  const remove = useMutation({
    mutationFn: (productId: string) => api(`/wishlist/${productId}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["wishlist"] }),
  });
  const move = useMutation({
    mutationFn: (productId: string) => api(`/wishlist/${productId}/move-to-cart`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wishlist"] });
      void queryClient.invalidateQueries({ queryKey: ["cart"] });
    },
  });
  const items = list.data?.data.items || [];
  if (!items.length && !list.isLoading) return <Empty title="Nothing saved" body="Use the heart on a product to keep it here." />;
  return (
    <div>
      <h1 className="font-display text-4xl">Wishlist</h1>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 rounded-lg border border-line bg-card p-3">
            <Photo src={item.product.image} alt="" className="h-16 w-14 rounded-md" />
            <div className="flex-1">
              <Link to={`/p/${item.product.slug}`} className="font-medium">{item.product.name}</Link>
              <p className="text-xs text-muted">{item.product.vendor.name} · {money(item.product.price)} · {item.product.inStock ? "In stock" : "Out of stock"}</p>
            </div>
            <Button variant="ghost" disabled={!item.product.inStock} onClick={() => move.mutate(item.productId)}>Move to cart</Button>
            <button type="button" className="text-sm text-muted" onClick={() => remove.mutate(item.productId)}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Address = { id: string; fullName: string; line1: string; line2: string | null; city: string; state: string; postalCode: string; country: string; phone: string | null; isDefaultShipping: boolean };

export function AddressesPage() {
  usePageTitle("Addresses");
  const queryClient = useQueryClient();
  const addresses = useQuery({ queryKey: ["addresses"], queryFn: () => api<Address[]>("/addresses") });
  const [form, setForm] = useState({ fullName: "", line1: "", city: "", state: "", postalCode: "", country: "US", isDefaultShipping: true });
  const save = useMutation({
    mutationFn: () => api("/addresses", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      setForm({ fullName: "", line1: "", city: "", state: "", postalCode: "", country: "US", isDefaultShipping: false });
      void queryClient.invalidateQueries({ queryKey: ["addresses"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/addresses/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["addresses"] }),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }
  return (
    <div>
      <h1 className="font-display text-4xl">Addresses</h1>
      <ul className="mt-4 space-y-2 text-sm">
        {addresses.data?.data.map((address) => (
          <li key={address.id} className="flex items-start justify-between rounded-md border border-line bg-card px-3 py-2">
            <span>{address.fullName}, {address.line1}, {address.city} {address.state} {address.postalCode}{address.isDefaultShipping ? " · default" : ""}</span>
            <button type="button" className="text-muted" onClick={() => remove.mutate(address.id)}>Remove</button>
          </li>
        ))}
      </ul>
      <form className="mt-6 grid max-w-lg gap-3" onSubmit={submit}>
        {(["fullName", "line1", "city", "state", "postalCode", "country"] as const).map((key) => (
          <input key={key} required placeholder={key} className={controlClass} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
        ))}
        {save.error ? <ErrorNote error={save.error} /> : null}
        <Button type="submit">Save address</Button>
      </form>
    </div>
  );
}

export function ReviewsPage() {
  usePageTitle("Your reviews");
  const reviews = useQuery({ queryKey: ["my-reviews"], queryFn: () => api<{ id: string; title: string; body: string; rating: number; status: string; product: { name: string; slug: string } }[]>("/me/reviews") });
  return (
    <div>
      <h1 className="font-display text-4xl">Reviews</h1>
      <ul className="mt-4 space-y-3">
        {(reviews.data?.data || []).map((review) => (
          <li key={review.id} className="rounded-lg border border-line bg-card p-3 text-sm">
            <Link to={`/p/${review.product.slug}`} className="font-medium">{review.product.name}</Link>
            <p>{review.rating}★ {review.title}</p>
            <p className="text-muted">{review.body}</p>
            <StatusBadge value={review.status} />
          </li>
        ))}
      </ul>
      {reviews.data && reviews.data.data.length === 0 ? <Empty title="No reviews yet" body="Reviews are available after you buy the product." /> : null}
    </div>
  );
}

export function ProfilePage() {
  usePageTitle("Profile");
  const user = useSession((state) => state.user);
  const setAuth = useSession((state) => state.setAuth);
  const token = useSession((state) => state.accessToken);
  const clear = useSession((state) => state.clear);
  const toast = useSession((state) => state.toast);
  const [profile, setProfile] = useState({ firstName: user?.firstName || "", lastName: user?.lastName || "", phone: user?.phone || "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", nextPassword: "" });

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    const result = await api<typeof user>("/auth/me", { method: "PATCH", body: JSON.stringify(profile) });
    if (token && result.data) setAuth(token, result.data);
    toast(result.message);
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/auth/change-password", { method: "POST", body: JSON.stringify(passwords) });
      clear();
      toast("Password changed. Sign in again.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not change password");
    }
  }
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    clear();
  }
  return (
    <div className="grid max-w-xl gap-8">
      <form className="space-y-3" onSubmit={saveProfile}>
        <h1 className="font-display text-4xl">Profile</h1>
        <input className={controlClass} value={profile.firstName} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })} />
        <input className={controlClass} value={profile.lastName} onChange={(event) => setProfile({ ...profile, lastName: event.target.value })} />
        <input className={controlClass} placeholder="Phone" value={profile.phone || ""} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} />
        <Button type="submit">Save profile</Button>
      </form>
      <form className="space-y-3" onSubmit={changePassword}>
        <h2 className="font-display text-2xl">Password</h2>
        <input type="password" className={controlClass} placeholder="Current password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} />
        <input type="password" className={controlClass} placeholder="New password" value={passwords.nextPassword} onChange={(event) => setPasswords({ ...passwords, nextPassword: event.target.value })} />
        <Button type="submit" variant="ghost">Change password</Button>
      </form>
      <Button variant="ghost" onClick={() => void logout()}>Sign out</Button>
    </div>
  );
}

export function SupportPage() {
  usePageTitle("Contact");
  const [form, setForm] = useState({ name: "", email: "", topic: "Order", message: "" });
  const [done, setDone] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await api("/support", { method: "POST", body: JSON.stringify(form) });
    setDone(result.message);
  }
  return (
    <form className="mx-auto max-w-lg space-y-3" onSubmit={submit}>
      <h1 className="font-display text-4xl">Contact</h1>
      <p className="text-sm text-muted">Questions about an order, a studio, or a return.</p>
      <input required className={controlClass} placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      <input required type="email" className={controlClass} placeholder="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
      <input required className={controlClass} placeholder="Topic" value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} />
      <textarea required className={controlClass} rows={5} placeholder="Message" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} />
      <Button type="submit">Send</Button>
      {done ? <p className="text-sm">{done}</p> : null}
    </form>
  );
}
