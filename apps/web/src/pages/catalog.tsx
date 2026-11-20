import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePageTitle } from "../components/chrome";
import { Button, Empty, ErrorNote, Modal, Photo, Price, Skeleton, Stars } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { listingSearch, optionsOf, rememberProduct } from "../lib/catalog";
import { useSession } from "../stores/session";
import { ProductCard } from "./home";

type Card = {
  id: string;
  name: string;
  slug: string;
  price: string;
  compareAtPrice: string | null;
  ratingAvg: string | null;
  ratingCount: number;
  image: string | null;
  inStock: boolean;
  vendor: { name: string; slug: string };
};

type Product = Card & {
  description: string;
  shortDescription: string;
  sku: string;
  tags: string[];
  shippingInfo: string | null;
  images: { url: string; alt: string | null }[];
  attributes: { name: string; values: string[] }[];
  variants: { id: string; sku: string; name: string | null; options: unknown; price: string; compareAtPrice: string | null; available: number }[];
  reviews: { id: string; rating: number; title: string; body: string; author: string; createdAt: string; vendorResponse: string | null }[];
  ratingBreakdown: Record<string, number>;
  related: Card[];
};

export function ListingPage({ category, vendor }: { category?: string; vendor?: string }) {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || undefined;
  const page = Number(params.get("page") || 1);
  const sort = params.get("sort") || "newest";
  const view = params.get("view") || "grid";
  const minPrice = params.get("minPrice") || "";
  const maxPrice = params.get("maxPrice") || "";
  const rating = params.get("rating") || "";
  const inStock = params.get("inStock") === "true";
  const brand = params.get("brand") || "";
  const activeCategory = category || params.get("category") || undefined;
  const activeVendor = vendor || params.get("vendor") || undefined;
  usePageTitle(q ? `Search “${q}”` : category ? "Category" : "Shop");
  const query = listingSearch({ q, category: activeCategory, vendor: activeVendor, brand, minPrice, maxPrice, rating, inStock, sort, page, pageSize: 12 });
  const products = useQuery({ queryKey: ["products", query], queryFn: () => api<Card[]>(`/products${query}`) });
  const [quick, setQuick] = useState<Card | null>(null);

  function update(next: Record<string, string | null>) {
    const copy = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (!value) copy.delete(key);
      else copy.set(key, value);
    }
    if (!("page" in next)) copy.delete("page");
    setParams(copy);
  }

  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <aside className="space-y-4 text-sm">
        <h1 className="font-display text-3xl">{q ? `Results for “${q}”` : "Shop"}</h1>
        <label className="block">Minimum price
          <input className="mt-1 w-full rounded-md border border-line px-2 py-1" value={minPrice} onChange={(event) => update({ minPrice: event.target.value })} />
        </label>
        <label className="block">Maximum price
          <input className="mt-1 w-full rounded-md border border-line px-2 py-1" value={maxPrice} onChange={(event) => update({ maxPrice: event.target.value })} />
        </label>
        <label className="block">Minimum rating
          <select className="mt-1 w-full rounded-md border border-line px-2 py-1" value={rating} onChange={(event) => update({ rating: event.target.value })}>
            <option value="">Any</option>
            <option value="4">4 and up</option>
            <option value="3">3 and up</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={inStock} onChange={(event) => update({ inStock: event.target.checked ? "true" : null })} />
          In stock
        </label>
        <button type="button" className="text-accent" onClick={() => setParams(q ? { q } : {})}>Clear filters</button>
      </aside>
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted">{String(products.data?.meta.total ?? 0)} pieces{products.data?.meta.engine ? ` · ${products.data.meta.engine}` : ""}</p>
          <div className="flex gap-2">
            <select aria-label="Sort" className="rounded-md border border-line bg-white px-2 py-1" value={sort} onChange={(event) => update({ sort: event.target.value })}>
              <option value="newest">Newest</option>
              <option value="price_asc">Price, low to high</option>
              <option value="price_desc">Price, high to low</option>
              <option value="popularity">Popularity</option>
              <option value="rating">Rating</option>
              {q ? <option value="relevance">Relevance</option> : null}
            </select>
            <button type="button" className="rounded-md border border-line px-2 py-1" onClick={() => update({ view: view === "list" ? "grid" : "list" })}>
              {view === "list" ? "Grid" : "List"}
            </button>
          </div>
        </div>
        {products.isLoading ? <Skeleton className="h-64" /> : null}
        {products.error ? <ErrorNote error={products.error} /> : null}
        {products.data && products.data.data.length === 0 ? <Empty title="Nothing matched" body="Try a broader search or clear a filter." /> : null}
        <div className={view === "list" ? "space-y-3" : "grid grid-cols-2 gap-3 lg:grid-cols-3"}>
          {products.data?.data.map((product) => (
            <div key={product.id}>
              <ProductCard product={product} />
              <button type="button" className="mt-1 text-xs text-muted" onClick={() => setQuick(product)}>Quick view</button>
            </div>
          ))}
        </div>
        <Pager page={page} pageCount={Number(products.data?.meta.pageCount || 1)} onPage={(next) => update({ page: String(next) })} />
      </section>
      {quick ? (
        <Modal title={quick.name} onClose={() => setQuick(null)}>
          <Photo src={quick.image} alt={quick.name} className="h-56 w-full rounded-md" />
          <p className="mt-3"><Price amount={quick.price} compare={quick.compareAtPrice} /></p>
          <p className="mt-1 text-sm text-muted">{quick.inStock ? "In stock" : "Out of stock"} · {quick.vendor.name}</p>
          <Link className="mt-4 inline-flex text-sm text-accent" to={`/p/${quick.slug}`}>Open the product</Link>
        </Modal>
      ) : null}
    </div>
  );
}

function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-6 flex items-center gap-3 text-sm">
      <Button type="button" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span>Page {page} of {pageCount}</span>
      <Button type="button" variant="ghost" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}

export function CategoryPage() {
  const { slug = "" } = useParams();
  const category = useQuery({ queryKey: ["category", slug], queryFn: () => api<{ name: string; description: string }>(`/categories/${slug}`) });
  return (
    <div>
      <p className="text-sm text-muted">{category.data?.data.description}</p>
      <ListingPage category={slug} />
    </div>
  );
}

export function StorePage() {
  const { slug = "" } = useParams();
  const store = useQuery({
    queryKey: ["store", slug],
    queryFn: () => api<{ name: string; description: string; coverUrl: string | null; location: string; ratingAvg: string; ratingCount: number; returnPolicy: string | null; shippingPolicy: string | null; products: Card[] }>(`/stores/${slug}`),
  });
  usePageTitle(store.data?.data.name || "Store");
  if (store.isLoading) return <Skeleton className="h-64" />;
  if (store.error || !store.data) return <ErrorNote error={store.error} />;
  const data = store.data.data;
  return (
    <div>
      <Photo src={data.coverUrl} alt="" className="h-56 w-full rounded-lg" />
      <h1 className="mt-4 font-display text-4xl">{data.name}</h1>
      <p className="mt-1 text-sm text-muted">{data.location} · <Stars value={Number(data.ratingAvg)} /> {data.ratingCount} reviews</p>
      <p className="mt-3 max-w-2xl text-muted">{data.description}</p>
      <div className="mt-4 grid gap-3 text-sm text-muted md:grid-cols-2">
        <p>{data.shippingPolicy}</p>
        <p>{data.returnPolicy}</p>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {data.products.map((product) => <ProductCard key={product.id} product={product} />)}
      </div>
    </div>
  );
}

export function ProductPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useSession((state) => state.toast);
  const user = useSession((state) => state.user);
  const product = useQuery({ queryKey: ["product", slug], queryFn: () => api<Product>(`/products/${slug}`) });
  const data = product.data?.data;
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [image, setImage] = useState(0);
  const [review, setReview] = useState({ rating: 5, title: "", body: "" });
  const keys = useMemo(() => Array.from(new Set((data?.variants || []).flatMap((variant) => Object.keys(optionsOf(variant.options))))), [data]);
  const selected = useMemo(() => {
    if (!data) return undefined;
    const match = data.variants.find((variant) => keys.every((key) => !choice[key] || optionsOf(variant.options)[key] === choice[key]));
    return match || data.variants.find((variant) => variant.available > 0) || data.variants[0];
  }, [data, keys, choice]);

  useEffect(() => {
    if (data?.id) rememberProduct(data.id);
  }, [data?.id]);
  usePageTitle(data?.name || "Product");

  const add = useMutation({
    mutationFn: (variantId: string) => api("/cart/items", { method: "POST", body: JSON.stringify({ variantId, quantity }) }),
    onSuccess: (result) => {
      toast(result.message);
      void queryClient.invalidateQueries({ queryKey: ["cart"] });
    },
    onError: (error) => toast(error.message),
  });
  const save = useMutation({
    mutationFn: () => api("/wishlist", { method: "POST", body: JSON.stringify({ productId: data?.id }) }),
    onSuccess: (result) => {
      toast(result.message);
      void queryClient.invalidateQueries({ queryKey: ["wishlist"] });
    },
    onError: (error) => toast(error.message),
  });
  const submitReview = useMutation({
    mutationFn: () => api("/reviews", { method: "POST", body: JSON.stringify({ productId: data?.id, ...review }) }),
    onSuccess: (result) => {
      toast(result.message);
      void queryClient.invalidateQueries({ queryKey: ["product", slug] });
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : "Could not save the review"),
  });

  if (product.isLoading) return <Skeleton className="h-96" />;
  if (product.error || !data || !selected) return <ErrorNote error={product.error || new Error("Product not found")} />;
  const valuesFor = (key: string) => Array.from(new Set(data.variants.map((variant) => optionsOf(variant.options)[key]).filter(Boolean)));

  function onReview(event: FormEvent) {
    event.preventDefault();
    submitReview.mutate();
  }

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div>
        <Photo src={data.images[image]?.url || data.image} alt={data.images[image]?.alt || data.name} className="aspect-[4/5] w-full rounded-lg" />
        <div className="mt-2 flex gap-2">
          {data.images.map((item, index) => (
            <button key={item.url} type="button" onClick={() => setImage(index)} className={index === image ? "ring-2 ring-accent" : ""}>
              <Photo src={item.url} alt={item.alt || ""} className="h-16 w-16 rounded-md" />
            </button>
          ))}
        </div>
      </div>
      <div>
        <Link to={`/store/${data.vendor.slug}`} className="text-sm text-muted">{data.vendor.name}</Link>
        <h1 className="mt-1 font-display text-4xl">{data.name}</h1>
        <p className="mt-2 text-sm text-muted">SKU {selected.sku}</p>
        <p className="mt-3 text-lg"><Price amount={selected.price} compare={selected.compareAtPrice} /></p>
        <p className="mt-1 text-sm"><Stars value={Number(data.ratingAvg)} /> <span className="text-muted">{data.ratingCount} reviews</span></p>
        <p className="mt-4 text-muted">{data.shortDescription}</p>
        <div className="mt-4 space-y-3">
          {keys.map((key) => (
            <div key={key}>
              <p className="text-sm font-medium">{key}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {valuesFor(key).map((value) => (
                  <button key={value} type="button" className={`rounded-md border px-3 py-1 text-sm ${choice[key] === value || (!choice[key] && optionsOf(selected.options)[key] === value) ? "border-ink bg-ink text-white" : "border-line"}`} onClick={() => setChoice({ ...choice, [key]: value })}>
                    {value}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm">{selected.available > 0 ? `${selected.available} available` : "Out of stock"}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="text-sm">Qty
            <input aria-label="Quantity" className="ml-2 w-16 rounded-md border border-line px-2 py-1" type="number" min={1} max={Math.max(selected.available, 1)} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
          </label>
          <Button data-testid="add-to-cart" disabled={selected.available < 1 || add.isPending} onClick={() => add.mutate(selected.id)}>Add to cart</Button>
          <Button variant="ghost" disabled={selected.available < 1 || add.isPending} onClick={() => add.mutate(selected.id, { onSuccess: () => navigate("/checkout") })}>Buy now</Button>
          <button type="button" aria-label="Save to wishlist" className="rounded-md border border-line p-2" onClick={() => save.mutate()}><Heart size={16} /></button>
        </div>
        <div className="mt-6 space-y-3 text-sm text-muted">
          <p>{data.description}</p>
          {data.shippingInfo ? <p>{data.shippingInfo}</p> : <p>Ships from the studio. Standard delivery is 5–7 business days.</p>}
          {data.attributes.map((attribute) => (
            <p key={attribute.name}><span className="text-ink">{attribute.name}:</span> {attribute.values.join(", ")}</p>
          ))}
          {data.tags.length ? <p>Tags: {data.tags.join(", ")}</p> : null}
        </div>
      </div>
      <section className="md:col-span-2">
        <h2 className="font-display text-3xl">Reviews</h2>
        <div className="mt-2 flex gap-3 text-sm text-muted">
          {Object.entries(data.ratingBreakdown).map(([star, count]) => <span key={star}>{star}★ {count}</span>)}
        </div>
        <div className="mt-4 space-y-4">
          {data.reviews.length === 0 ? <p className="text-sm text-muted">No published reviews yet.</p> : null}
          {data.reviews.map((item) => (
            <article key={item.id} className="border-t border-line pt-3">
              <p className="text-sm"><Stars value={item.rating} /> · {item.author}</p>
              <h3 className="font-medium">{item.title}</h3>
              <p className="text-sm text-muted">{item.body}</p>
              {item.vendorResponse ? <p className="mt-2 text-sm">Studio reply: {item.vendorResponse}</p> : null}
            </article>
          ))}
        </div>
        {user?.role === "CUSTOMER" ? (
          <form className="mt-6 max-w-lg space-y-3" onSubmit={onReview}>
            <h3 className="font-medium">Write a review</h3>
            <label className="block text-sm">Rating
              <input className="mt-1 w-24 rounded-md border border-line px-2 py-1" type="number" min={1} max={5} value={review.rating} onChange={(event) => setReview({ ...review, rating: Number(event.target.value) })} />
            </label>
            <input className="w-full rounded-md border border-line px-3 py-2 text-sm" placeholder="Title" value={review.title} onChange={(event) => setReview({ ...review, title: event.target.value })} required />
            <textarea className="w-full rounded-md border border-line px-3 py-2 text-sm" placeholder="What was it like to use?" value={review.body} onChange={(event) => setReview({ ...review, body: event.target.value })} required />
            <Button type="submit" disabled={submitReview.isPending}>Submit review</Button>
          </form>
        ) : null}
      </section>
      <section className="md:col-span-2">
        <h2 className="font-display text-3xl">Related</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {data.related.map((item) => <ProductCard key={item.id} product={item} />)}
        </div>
      </section>
    </div>
  );
}
