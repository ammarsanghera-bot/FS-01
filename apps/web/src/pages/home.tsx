import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { usePageTitle } from "../components/chrome";
import { Photo, Price, Skeleton, Stars } from "../components/ui";
import { api } from "../lib/api";
import { readRecent } from "../lib/catalog";

type Card = {
  id: string;
  name: string;
  slug: string;
  price: string;
  compareAtPrice: string | null;
  ratingAvg: string | null;
  ratingCount: number;
  image: string | null;
  vendor: { name: string; slug: string };
};

type HomeData = {
  banners: { title: string; subtitle: string; href: string; image: string }[];
  categories: { id: string; name: string; slug: string; description: string; imageUrl: string | null }[];
  featured: Card[];
  trending: Card[];
  bestSellers: Card[];
  recommended: Card[];
  deals: Card[];
  vendors: { id: string; name: string; slug: string; description: string; logoUrl: string | null; location: string; ratingAvg: string; ratingCount: number }[];
};

export function HomePage() {
  usePageTitle("Northstar");
  const home = useQuery({ queryKey: ["home"], queryFn: () => api<HomeData>("/catalog/home") });
  const recentIds = readRecent();
  const recent = useQuery({
    queryKey: ["recent", recentIds.join(",")],
    enabled: recentIds.length > 0,
    queryFn: () => api<Card[]>(`/products?ids=${recentIds.join(",")}`),
  });
  if (home.isLoading) return <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-64" />)}</div>;
  if (home.error) return <p className="text-sm text-[#8d3a32]">{home.error.message}</p>;
  const data = home.data!.data;
  const hero = data.banners[0];
  return (
    <div className="space-y-12">
      {hero ? (
        <section className="grid items-center gap-8 md:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted">Independent studios</p>
            <h1 className="mt-3 font-display text-5xl leading-tight text-ink">{hero.title}</h1>
            <p className="mt-4 max-w-md text-muted">{hero.subtitle}</p>
            <Link to={hero.href} className="mt-6 inline-flex rounded-md bg-accent px-4 py-2 text-sm text-white">Shop this edit</Link>
          </div>
          <Photo src={hero.image} alt={hero.title} className="h-80 w-full rounded-lg" />
        </section>
      ) : null}
      <section>
        <h2 className="font-display text-3xl">Departments</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {data.categories.slice(0, 6).map((category) => (
            <Link key={category.id} to={`/c/${category.slug}`} className="group overflow-hidden rounded-lg border border-line bg-card">
              <Photo src={category.imageUrl} alt="" className="h-36 w-full" />
              <div className="p-3">
                <p className="font-medium">{category.name}</p>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{category.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <ProductRow title="Featured" products={data.featured} />
      <ProductRow title="Just in" products={data.trending} />
      <ProductRow title="Best sellers" products={data.bestSellers} />
      <ProductRow title="Recommended" products={data.recommended} />
      <ProductRow title="Marked down" products={data.deals} />
      <section>
        <h2 className="font-display text-3xl">Studios</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {data.vendors.map((vendor) => (
            <Link key={vendor.id} to={`/store/${vendor.slug}`} className="rounded-lg border border-line bg-card p-4">
              <div className="flex items-center gap-3">
                <Photo src={vendor.logoUrl} alt="" className="h-12 w-12 rounded-full" />
                <div>
                  <p className="font-medium">{vendor.name}</p>
                  <p className="text-xs text-muted">{vendor.location}</p>
                </div>
              </div>
              <p className="mt-3 line-clamp-3 text-sm text-muted">{vendor.description}</p>
              <p className="mt-3 text-sm"><Stars value={Number(vendor.ratingAvg)} /> <span className="text-muted">{vendor.ratingCount}</span></p>
            </Link>
          ))}
        </div>
      </section>
      {data.banners[1] ? (
        <Link to={data.banners[1].href} className="grid overflow-hidden rounded-lg border border-line bg-card md:grid-cols-[1.2fr_1fr]">
          <Photo src={data.banners[1].image} alt="" className="h-56 w-full" />
          <div className="p-6">
            <h2 className="font-display text-3xl">{data.banners[1].title}</h2>
            <p className="mt-2 text-muted">{data.banners[1].subtitle}</p>
          </div>
        </Link>
      ) : null}
      {recent.data?.data.length ? <ProductRow title="Recently viewed" products={recent.data.data} /> : null}
    </div>
  );
}

export function ProductRow({ title, products }: { title: string; products: Card[] }) {
  if (!products.length) return null;
  return (
    <section>
      <h2 className="font-display text-3xl">{title}</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}

export function ProductCard({ product }: { product: Card }) {
  return (
    <article data-testid="product-card" className="overflow-hidden rounded-lg border border-line bg-card">
      <Link to={`/p/${product.slug}`}>
        <Photo src={product.image} alt={product.name} className="aspect-[4/5] w-full" />
      </Link>
      <div className="p-3">
        <Link to={`/store/${product.vendor.slug}`} className="text-xs uppercase tracking-wide text-muted">{product.vendor.name}</Link>
        <Link to={`/p/${product.slug}`} className="mt-1 block font-medium leading-snug">{product.name}</Link>
        <div className="mt-2 flex items-center justify-between gap-2">
          <Price amount={product.price} compare={product.compareAtPrice} />
          {product.ratingCount ? <span className="text-xs text-muted"><Stars value={Number(product.ratingAvg)} /></span> : null}
        </div>
      </div>
    </article>
  );
}
