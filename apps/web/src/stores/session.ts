import { create } from "zustand";

export type SessionUser = {
  id: string;
  email: string;
  role: "CUSTOMER" | "VENDOR" | "ADMIN";
  status: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  emailVerified: boolean;
  vendorStatus: string | null;
  store: { id: string; name: string; slug: string; status: string } | null;
};

type Toast = { id: number; message: string };

type SessionState = {
  ready: boolean;
  accessToken: string | null;
  user: SessionUser | null;
  sessionId: string;
  toasts: Toast[];
  setAuth: (accessToken: string, user: SessionUser) => void;
  setReady: (ready: boolean) => void;
  clear: () => void;
  toast: (message: string) => void;
  dismiss: (id: number) => void;
};

function loadSessionId() {
  if (typeof localStorage === "undefined") return "guestsession";
  const key = "northstar.session";
  const existing = localStorage.getItem(key) || "";
  if (/^[a-zA-Z0-9_-]{8,80}$/.test(existing)) return existing;
  const next = crypto.randomUUID().replace(/-/g, "");
  localStorage.setItem(key, next);
  return next;
}

export const useSession = create<SessionState>((set, get) => ({
  ready: false,
  accessToken: null,
  user: null,
  sessionId: loadSessionId(),
  toasts: [],
  setAuth: (accessToken, user) => set({ accessToken, user }),
  setReady: (ready) => set({ ready }),
  clear: () => set({ accessToken: null, user: null }),
  toast: (message) => {
    const id = Date.now() + Math.random();
    set({ toasts: [...get().toasts, { id, message }] });
    window.setTimeout(() => {
      set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
    }, 4200);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
}));
