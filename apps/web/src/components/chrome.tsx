import { Bell, Menu, Search, ShoppingBag, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useSession } from "../stores/session";
import { Button } from "./ui";

type Category = { id: string; name: string; slug: string };
type Cart = { items: { id: string }[] };
type Home = { announcement?: string; marketplaceName?: string };

export function StorefrontLayout() {
  return (
    <div className="min-h-screen">
      <Announcement />
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

function Announcement() {
  const home = useQuery({ queryKey: ["home"], queryFn: () => api<Home>("/catalog/home") });
  const text = home.data?.data.announcement;
  if (!text) return null;
  return <div className="bg-ink px-4 py-2 text-center text-xs tracking-wide text-[#f4f1ea]">{text}</div>;
}

function Header() {
  const navigate = useNavigate();
  const user = useSession((state) => state.user);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/categories") });
  const cart = useQuery({ queryKey: ["cart"], queryFn: () => api<Cart>("/cart") });
  const unread = useQuery({
    queryKey: ["unread"],
    enabled: Boolean(user),
    queryFn: () => api<{ unread: number }>("/notifications/unread-count"),
  });
  const suggestions = useQuery({
    queryKey: ["suggest", query],
    enabled: query.trim().length >= 2,
    queryFn: () => api<{ name: string; slug: string }[]>(`/search/suggest?q=${encodeURIComponent(query.trim())}`),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setSuggestOpen(false);
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <header className="border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
        <button className="md:hidden" type="button" aria-label="Open menu" onClick={() => setOpen(true)}>
          <Menu size={20} />
        </button>
        <Link to="/" className="font-display text-2xl tracking-tight">
          Northstar
        </Link>
        <form className="relative mx-auto hidden min-w-0 flex-1 md:block" onSubmit={submit}>
          <label className="sr-only" htmlFor="site-search">Search the marketplace</label>
          <Search className="pointer-events-none absolute left-3 top-2.5 text-muted" size={16} />
          <input
            id="site-search"
            data-testid="search"
            className="w-full rounded-md border border-line bg-white py-2 pl-9 pr-3 text-sm"
            placeholder="Search makers, materials, SKUs"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSuggestOpen(true);
            }}
            onFocus={() => setSuggestOpen(true)}
          />
          {suggestOpen && suggestions.data?.data.length ? (
            <div className="absolute z-20 mt-1 w-full rounded-md border border-line bg-card py-1 shadow-card">
              {suggestions.data.data.map((item) => (
                <Link key={item.slug} className="block px-3 py-2 text-sm hover:bg-[#f3efe6]" to={`/p/${item.slug}`} onClick={() => setSuggestOpen(false)}>
                  {item.name}
                </Link>
              ))}
            </div>
          ) : null}
        </form>
        <nav className="ml-auto flex items-center gap-2 text-sm">
          <Link to="/search" className="hidden px-2 py-1 md:inline">Shop</Link>
          {user?.role === "VENDOR" ? <Link to="/vendor" className="px-2 py-1">Studio</Link> : null}
          {user?.role === "ADMIN" ? <Link to="/admin" className="px-2 py-1">Admin</Link> : null}
          {user ? (
            <Link to="/account" className="px-2 py-1">{user.firstName}</Link>
          ) : (
            <Link to="/login" className="px-2 py-1">Sign in</Link>
          )}
          {user ? (
            <Link to="/account" className="relative px-2 py-1" aria-label="Notifications">
              <Bell size={18} />
              {unread.data?.data.unread ? (
                <span className="absolute -right-1 -top-1 rounded-full bg-accent px-1.5 text-[10px] text-white">{unread.data.data.unread}</span>
              ) : null}
            </Link>
          ) : null}
          <Link to="/cart" className="relative px-2 py-1" aria-label="Cart" data-testid="cart-link">
            <ShoppingBag size={18} />
            <span className="absolute -right-1 -top-1 rounded-full bg-ink px-1.5 text-[10px] text-white" data-testid="cart-count">
              {cart.data?.data.items.length ?? 0}
            </span>
          </Link>
        </nav>
      </div>
      <nav className="mx-auto hidden max-w-6xl gap-4 px-4 pb-3 text-sm text-muted md:flex">
        {(categories.data?.data || []).slice(0, 9).map((category) => (
          <Link key={category.id} to={`/c/${category.slug}`} className="hover:text-ink">
            {category.name}
          </Link>
        ))}
      </nav>
      {open ? (
        <div className="fixed inset-0 z-30 bg-[#172033]/40 md:hidden" onClick={() => setOpen(false)}>
          <div className="h-full w-72 bg-paper p-4" onClick={(event) => event.stopPropagation()}>
            <button type="button" aria-label="Close menu" onClick={() => setOpen(false)}><X size={18} /></button>
            <form className="mt-4" onSubmit={submit}>
              <input className="w-full rounded-md border border-line px-3 py-2 text-sm" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </form>
            <div className="mt-4 flex flex-col gap-2 text-sm">
              {(categories.data?.data || []).map((category) => (
                <Link key={category.id} to={`/c/${category.slug}`} onClick={() => setOpen(false)}>{category.name}</Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm md:grid-cols-4">
        <div>
          <p className="font-display text-xl">Northstar</p>
          <p className="mt-2 text-muted">A marketplace of small studios. Goods are packed by the people who made them.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Link to="/search">Shop</Link>
          <Link to="/support">Contact</Link>
          <Link to="/register?role=VENDOR">Sell on Northstar</Link>
        </div>
        <div className="flex flex-col gap-2 text-muted">
          <span>Standard shipping over $75 is included.</span>
          <span>Tax is calculated at checkout.</span>
        </div>
        <Newsletter />
      </div>
    </footer>
  );
}

function Newsletter() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState("");
  const toast = useSession((state) => state.toast);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api("/newsletter", { method: "POST", body: JSON.stringify({ email }) });
      setDone(result.message);
      toast(result.message);
      setEmail("");
    } catch (error) {
      setDone(error instanceof Error ? error.message : "Could not subscribe");
    }
  }
  return (
    <form onSubmit={submit}>
      <label className="block text-sm font-medium" htmlFor="newsletter">Notes from the floor</label>
      <div className="mt-2 flex gap-2">
        <input id="newsletter" type="email" required className="w-full rounded-md border border-line px-3 py-2" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
        <Button type="submit">Join</Button>
      </div>
      {done ? <p className="mt-2 text-xs text-muted">{done}</p> : null}
    </form>
  );
}

export function DashboardLayout({ title, links }: { title: string; links: { to: string; label: string }[] }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="font-display text-2xl">Northstar</Link>
          <span className="text-sm text-muted">{title}</span>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:grid-cols-[200px_1fr]">
        <aside className="flex gap-2 overflow-auto md:flex-col">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.to.split("/").length <= 2} className={({ isActive }) => `whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "text-ink hover:bg-[#ece7dc]"}`}>
              {link.label}
            </NavLink>
          ))}
        </aside>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function RequireAuth({ roles, children }: { roles?: Array<"CUSTOMER" | "VENDOR" | "ADMIN">; children?: React.ReactNode }) {
  const ready = useSession((state) => state.ready);
  const user = useSession((state) => state.user);
  const location = useLocation();
  if (!ready) return <p className="p-8 text-sm text-muted">Loading your session…</p>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children ? <>{children}</> : <Outlet />;
}

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title === "Northstar" ? title : `${title} · Northstar`;
  }, [title]);
}
