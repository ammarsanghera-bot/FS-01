import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useSession } from "../stores/session";
import { labelize, money } from "../lib/catalog";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-accent text-white hover:bg-[#24348f] disabled:bg-[#9aa3c7]",
    ghost: "bg-white text-ink border border-line hover:bg-[#f7f4ee]",
    danger: "bg-[#8d3a32] text-white hover:bg-[#742f29]",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-[#8d3a32]">{error}</span> : null}
    </label>
  );
}

export const controlClass = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-[#8b8376]";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const tones = {
    neutral: "bg-[#ece7dc] text-ink",
    good: "bg-[#e5efe4] text-[#245c32]",
    warn: "bg-[#f8efd8] text-[#7a5b12]",
    bad: "bg-[#f6e4e1] text-[#8d3a32]",
  }[tone];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tones}`}>{children}</span>;
}

export function StatusBadge({ value }: { value: string }) {
  const bad = ["CANCELLED", "REJECTED", "FAILED", "SUSPENDED", "REFUNDED"].includes(value);
  const warn = ["PENDING", "PENDING_APPROVAL", "AWAITING_PAYMENT", "PROCESSING", "PARTIALLY_REFUNDED", "PARTIALLY_SHIPPED"].includes(value);
  const good = ["APPROVED", "PAID", "DELIVERED", "SUCCEEDED", "ACTIVE", "SHIPPED"].includes(value);
  return <Badge tone={bad ? "bad" : warn ? "warn" : good ? "good" : "neutral"}>{labelize(value)}</Badge>;
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-card px-6 py-12 text-center">
      <h2 className="font-display text-2xl text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{body}</p>
    </div>
  );
}

export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-[#e7e1d6] ${className}`} />;
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Something went wrong";
  return <p className="rounded-md border border-[#efd0cb] bg-[#fbf3f1] px-3 py-2 text-sm text-[#8d3a32]">{message}</p>;
}

export function Price({ amount, compare }: { amount: string | number | null | undefined; compare?: string | null }) {
  const current = Number(amount || 0);
  const previous = compare ? Number(compare) : 0;
  const sale = previous > current;
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="font-medium">{money(amount)}</span>
      {sale ? <span className="text-sm text-muted line-through">{money(compare)}</span> : null}
    </span>
  );
}

export function Photo({ src, alt, className = "" }: { src?: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`grid place-items-center bg-[#e7e1d6] font-display text-3xl text-ink ${className}`} aria-hidden>
        {(alt.trim()[0] || "N").toUpperCase()}
      </div>
    );
  }
  return <img src={src} alt={alt} className={`object-cover ${className}`} onError={() => setFailed(true)} />;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-[#172033]/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg bg-card p-5 shadow-card">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-2xl">{title}</h2>
          <button type="button" className="text-sm text-muted" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useSession((state) => state.toasts);
  const dismiss = useSession((state) => state.dismiss);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <button key={toast.id} type="button" className="rounded-md bg-ink px-3 py-2 text-left text-sm text-white shadow-card" onClick={() => dismiss(toast.id)}>
          {toast.message}
        </button>
      ))}
    </div>
  );
}

export function Stars({ value }: { value: number }) {
  const rounded = Math.round(value);
  return (
    <span className="text-sm tracking-tight text-[#9a6b16]" aria-label={`${value} out of 5 stars`}>
      {"★★★★★".slice(0, rounded)}
      <span className="text-[#d9d0c2]">{"★★★★★".slice(rounded)}</span>
    </span>
  );
}
