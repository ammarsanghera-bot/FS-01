import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { usePageTitle } from "../components/chrome";
import { Button, Empty, ErrorNote, Photo, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { money, optionsOf } from "../lib/catalog";
import { useSession } from "../stores/session";

type CartItem = {
  id: string;
  quantity: number;
  product: { id: string; name: string; slug: string; image: string | null };
  variant: { id: string; sku: string; options: unknown; available: number };
  store: { name: string; slug: string };
};

type Quote = {
  subtotal: string;
  discount: string;
  shipping: string;
  tax: string;
  grandTotal: string;
  groups: { storeName: string; lines: { name: string; quantity: number; lineTotal: string }[] }[];
};

type Cart = { id: string; couponCode: string | null; items: CartItem[]; quote: Quote | null; issues: string[] };

type Address = { id?: string; fullName: string; line1: string; line2?: string | null; city: string; state: string; postalCode: string; country: string; phone?: string | null };

type Order = {
  orderNumber: string;
  status: string;
  subtotal: string;
  discount: string;
  shipping: string;
  tax: string;
  grandTotal: string;
  couponCode: string | null;
  shippingMethod: string;
  shippingAddress: Address;
  createdAt: string;
  payment: { id: string; status: string; provider: string; amount: string } | null;
  events: { message: string; createdAt: string }[];
  vendorOrders: {
    id: string;
    orderNumber: string;
    status: string;
    store: { name: string; slug: string };
    subtotal: string;
    shipping: string;
    items: { id: string; productId: string; name: string; sku: string; quantity: number; lineTotal: string; options: unknown }[];
    shipments: { carrier: string; trackingNumber: string; status: string }[];
  }[];
};

export function CartPage() {
  usePageTitle("Cart");
  const queryClient = useQueryClient();
  const toast = useSession((state) => state.toast);
  const cart = useQuery({ queryKey: ["cart"], queryFn: () => api<Cart>("/cart") });
  const [code, setCode] = useState("");
  const update = useMutation({
    mutationFn: (input: { id: string; quantity: number }) => api(`/cart/items/${input.id}`, { method: "PATCH", body: JSON.stringify({ quantity: input.quantity }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["cart"] }),
    onError: (error) => toast(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/cart/items/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["cart"] }),
  });
  const coupon = useMutation({
    mutationFn: (next: string | null) => api("/cart/coupon", { method: "PUT", body: JSON.stringify({ code: next }) }),
    onSuccess: (result) => {
      toast(result.message);
      void queryClient.invalidateQueries({ queryKey: ["cart"] });
    },
    onError: (error) => toast(error.message),
  });
  const data = cart.data?.data;
  if (cart.isLoading) return <p className="text-sm text-muted">Loading cart…</p>;
  if (cart.error) return <ErrorNote error={cart.error} />;
  if (!data || data.items.length === 0) return <Empty title="Your cart is empty" body="The studios are open. Start with a search or a department." />;
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        <h1 className="font-display text-4xl">Cart</h1>
        {data.issues.map((issue) => <ErrorNote key={issue} error={new Error(issue)} />)}
        {data.items.map((item) => (
          <article key={item.id} className="flex gap-4 rounded-lg border border-line bg-card p-3">
            <Photo src={item.product.image} alt="" className="h-24 w-20 rounded-md" />
            <div className="min-w-0 flex-1">
              <Link to={`/store/${item.store.slug}`} className="text-xs text-muted">{item.store.name}</Link>
              <Link to={`/p/${item.product.slug}`} className="block font-medium">{item.product.name}</Link>
              <p className="text-xs text-muted">{item.variant.sku} {Object.values(optionsOf(item.variant.options)).join(" · ")}</p>
              <div className="mt-2 flex items-center gap-2 text-sm">
                <label>Qty
                  <input className="ml-2 w-16 rounded-md border border-line px-2 py-1" type="number" min={1} max={item.variant.available} value={item.quantity} onChange={(event) => update.mutate({ id: item.id, quantity: Number(event.target.value) })} />
                </label>
                <button type="button" className="text-muted" onClick={() => remove.mutate(item.id)}>Remove</button>
              </div>
            </div>
          </article>
        ))}
      </div>
      <aside className="h-fit rounded-lg border border-line bg-card p-4">
        <Totals quote={data.quote} />
        <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); coupon.mutate(code); }}>
          <input className="w-full rounded-md border border-line px-2 py-1 text-sm" placeholder="Coupon" value={code} onChange={(event) => setCode(event.target.value)} />
          <Button type="submit" variant="ghost">Apply</Button>
        </form>
        {data.couponCode ? <button type="button" className="mt-2 text-xs text-muted" onClick={() => coupon.mutate(null)}>Remove {data.couponCode}</button> : null}
        <Link to="/checkout" className="mt-4 block rounded-md bg-accent px-3 py-2 text-center text-sm text-white" data-testid="checkout">Checkout</Link>
      </aside>
    </div>
  );
}

function Totals({ quote }: { quote: Quote | null }) {
  if (!quote) return <p className="text-sm text-muted">Totals appear once every line can be priced.</p>;
  return (
    <dl className="space-y-1 text-sm">
      <Row label="Subtotal" value={quote.subtotal} />
      <Row label="Discount" value={quote.discount} />
      <Row label="Shipping" value={quote.shipping} />
      <Row label="Tax" value={quote.tax} />
      <Row label="Total" value={quote.grandTotal} strong />
    </dl>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-line pt-2 font-medium" : ""}`}>
      <dt>{label}</dt>
      <dd>{money(value)}</dd>
    </div>
  );
}

const blankAddress = { fullName: "", line1: "", city: "", state: "", postalCode: "", country: "US" };

export function CheckoutPage() {
  usePageTitle("Checkout");
  const navigate = useNavigate();
  const user = useSession((state) => state.user);
  const toast = useSession((state) => state.toast);
  const cart = useQuery({ queryKey: ["cart"], queryFn: () => api<Cart>("/cart") });
  const addresses = useQuery({ queryKey: ["addresses"], queryFn: () => api<Address[]>("/addresses") });
  const [method, setMethod] = useState("standard");
  const [address, setAddress] = useState<Address>(blankAddress);
  const [savedId, setSavedId] = useState("");
  const quote = useQuery({
    queryKey: ["quote", method, cart.data?.data.couponCode],
    enabled: Boolean(user && cart.data?.data.items.length),
    queryFn: () => api<Quote>("/checkout/quote", { method: "POST", body: JSON.stringify({ shippingMethod: method, couponCode: cart.data?.data.couponCode }) }),
  });
  const place = useMutation({
    mutationFn: () => {
      const key = sessionStorage.getItem("northstar.idempotency") || crypto.randomUUID();
      sessionStorage.setItem("northstar.idempotency", key);
      return api<Order>("/checkout", {
        method: "POST",
        headers: { "idempotency-key": key },
        body: JSON.stringify({ shippingMethod: method, couponCode: cart.data?.data.couponCode, shippingAddress: address, billingAddress: address }),
      });
    },
    onSuccess: (result) => {
      sessionStorage.removeItem("northstar.idempotency");
      toast(result.message);
      navigate(`/pay/${result.data.orderNumber}`);
    },
    onError: (error) => toast(error.message),
  });

  function chooseSaved(id: string) {
    setSavedId(id);
    const found = addresses.data?.data.find((item) => item.id === id);
    if (found) setAddress({ fullName: found.fullName, line1: found.line1, line2: found.line2, city: found.city, state: found.state, postalCode: found.postalCode, country: found.country, phone: found.phone });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    place.mutate();
  }

  if (!cart.data?.data.items.length && !cart.isLoading) return <Empty title="Nothing to check out" body="Add a product before placing an order." />;
  return (
    <form className="grid gap-8 md:grid-cols-[1fr_280px]" onSubmit={submit}>
      <div className="space-y-4">
        <h1 className="font-display text-4xl">Checkout</h1>
        <p className="text-sm text-muted">Signed in as {user?.email}. One payment covers every studio in the cart.</p>
        {addresses.data?.data.length ? (
          <label className="block text-sm">Saved address
            <select className="mt-1 w-full rounded-md border border-line px-2 py-2" value={savedId} onChange={(event) => chooseSaved(event.target.value)}>
              <option value="">Enter a new address</option>
              {addresses.data.data.map((item) => <option key={item.id} value={item.id}>{item.fullName}, {item.line1}, {item.city}</option>)}
            </select>
          </label>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {(["fullName", "line1", "city", "state", "postalCode", "country"] as const).map((key) => (
            <label key={key} className="text-sm capitalize">{key}
              <input required className="mt-1 w-full rounded-md border border-line px-3 py-2" value={address[key] || ""} onChange={(event) => setAddress({ ...address, [key]: event.target.value })} />
            </label>
          ))}
        </div>
        <fieldset className="space-y-2 text-sm">
          <legend className="font-medium">Shipping</legend>
          <label className="flex gap-2"><input type="radio" name="ship" checked={method === "standard"} onChange={() => setMethod("standard")} /> Standard, 5–7 business days</label>
          <label className="flex gap-2"><input type="radio" name="ship" checked={method === "express"} onChange={() => setMethod("express")} /> Express, 2–3 business days</label>
        </fieldset>
      </div>
      <aside className="h-fit rounded-lg border border-line bg-card p-4">
        <Totals quote={quote.data?.data || cart.data?.data.quote || null} />
        {quote.data?.data.groups.map((group) => (
          <p key={group.storeName} className="mt-3 text-xs text-muted">{group.storeName}: {group.lines.map((line) => `${line.name} × ${line.quantity}`).join(", ")}</p>
        ))}
        <Button className="mt-4 w-full" type="submit" data-testid="place-order" disabled={place.isPending}>Place order</Button>
      </aside>
    </form>
  );
}

export function PayPage() {
  const { orderNumber = "" } = useParams();
  const navigate = useNavigate();
  const toast = useSession((state) => state.toast);
  const order = useQuery({ queryKey: ["order", orderNumber], queryFn: () => api<Order>(`/orders/${orderNumber}`) });
  const [card, setCard] = useState({ name: "", number: "", expiry: "", cvc: "" });
  const [localError, setLocalError] = useState("");
  usePageTitle("Payment");
  const confirm = useMutation({
    mutationFn: (outcome: "success" | "failure") => api<Order>(`/payments/${order.data?.data.payment?.id}/confirm`, { method: "POST", body: JSON.stringify({ outcome }) }),
    onSuccess: (result) => {
      toast(result.message);
      if (result.data.payment?.status === "SUCCEEDED") navigate(`/orders/${orderNumber}`);
    },
    onError: (error) => toast(error.message),
  });

  function pay(event: FormEvent) {
    event.preventDefault();
    const digits = card.number.replace(/\s/g, "");
    if (!/^\d{16}$/.test(digits) || !/^\d{2}\/\d{2}$/.test(card.expiry) || !/^\d{3}$/.test(card.cvc) || card.name.trim().length < 2) {
      setLocalError("Check the name, card number, expiry, and CVC. Nothing here is sent to the server.");
      return;
    }
    setLocalError("");
    confirm.mutate("success");
  }

  if (order.isLoading) return <p className="text-sm text-muted">Loading payment…</p>;
  if (order.error || !order.data) return <ErrorNote error={order.error} />;
  const data = order.data.data;
  if (data.payment?.status === "SUCCEEDED") return <Empty title="This order is already paid" body={`Order ${data.orderNumber} is confirmed.`} />;
  return (
    <form className="mx-auto max-w-md space-y-3" onSubmit={pay}>
      <h1 className="font-display text-4xl">Pay {money(data.grandTotal)}</h1>
      <p className="text-sm text-muted">Mock checkout for {data.orderNumber}. The card stays in this browser. The server only receives success or failure.</p>
      <label className="block text-sm">Name on card<input className="mt-1 w-full rounded-md border border-line px-3 py-2" value={card.name} onChange={(event) => setCard({ ...card, name: event.target.value })} /></label>
      <label className="block text-sm">Card number<input inputMode="numeric" autoComplete="off" className="mt-1 w-full rounded-md border border-line px-3 py-2" placeholder="4242 4242 4242 4242" value={card.number} onChange={(event) => setCard({ ...card, number: event.target.value })} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">Expiry<input className="mt-1 w-full rounded-md border border-line px-3 py-2" placeholder="12/28" value={card.expiry} onChange={(event) => setCard({ ...card, expiry: event.target.value })} /></label>
        <label className="text-sm">CVC<input className="mt-1 w-full rounded-md border border-line px-3 py-2" placeholder="123" value={card.cvc} onChange={(event) => setCard({ ...card, cvc: event.target.value })} /></label>
      </div>
      {localError ? <ErrorNote error={new Error(localError)} /> : null}
      <Button type="submit" data-testid="pay" className="w-full" disabled={confirm.isPending}>Pay {money(data.grandTotal)}</Button>
      <button type="button" className="text-sm text-muted" onClick={() => confirm.mutate("failure")}>Simulate a decline</button>
    </form>
  );
}

export function OrderPage() {
  const { orderNumber = "" } = useParams();
  const toast = useSession((state) => state.toast);
  const queryClient = useQueryClient();
  const order = useQuery({ queryKey: ["order", orderNumber], queryFn: () => api<Order>(`/orders/${orderNumber}`) });
  usePageTitle(orderNumber || "Order");
  const cancel = useMutation({
    mutationFn: () => api(`/orders/${orderNumber}/cancel`, { method: "POST" }),
    onSuccess: (result) => {
      toast(result.message);
      void queryClient.invalidateQueries({ queryKey: ["order", orderNumber] });
    },
    onError: (error) => toast(error.message),
  });
  if (order.isLoading) return <p className="text-sm text-muted">Loading order…</p>;
  if (order.error || !order.data) return <ErrorNote error={order.error} />;
  const data = order.data.data;
  return (
    <div data-testid="order">
      <p className="text-sm text-muted">Order</p>
      <h1 className="font-display text-4xl" data-testid="order-number">{data.orderNumber}</h1>
      <div className="mt-2"><StatusBadge value={data.status} /></div>
      <p className="mt-3 text-sm text-muted">{money(data.grandTotal)} · {data.shippingMethod} shipping{data.couponCode ? ` · ${data.couponCode}` : ""}</p>
      <div className="mt-6 space-y-4">
        {data.vendorOrders.map((vendorOrder) => (
          <section key={vendorOrder.id} className="rounded-lg border border-line bg-card p-4" data-testid="suborder">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium">{vendorOrder.store.name}</h2>
              <StatusBadge value={vendorOrder.status} />
            </div>
            <p className="text-xs text-muted">{vendorOrder.orderNumber}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {vendorOrder.items.map((item) => <li key={item.id}>{item.name} × {item.quantity} · {money(item.lineTotal)}</li>)}
            </ul>
            {vendorOrder.shipments.map((shipment) => (
              <p key={shipment.trackingNumber} className="mt-2 text-sm">{shipment.carrier} {shipment.trackingNumber}</p>
            ))}
          </section>
        ))}
      </div>
      <ol className="mt-6 space-y-2 text-sm text-muted">
        {data.events.map((event) => <li key={event.createdAt + event.message}>{new Date(event.createdAt).toLocaleString()} — {event.message}</li>)}
      </ol>
      {data.status === "AWAITING_PAYMENT" ? (
        <div className="mt-4 flex gap-2">
          <Link to={`/pay/${data.orderNumber}`} className="rounded-md bg-accent px-3 py-2 text-sm text-white">Continue to payment</Link>
          <Button variant="ghost" onClick={() => cancel.mutate()}>Cancel unpaid order</Button>
        </div>
      ) : null}
    </div>
  );
}
