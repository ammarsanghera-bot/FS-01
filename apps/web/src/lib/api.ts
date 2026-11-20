import { useSession, type SessionUser } from "../stores/session";

const base = (import.meta.env.VITE_API_URL || "/api/v1").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  errors: { path?: string; message: string }[];
  code?: string;

  constructor(message: string, status: number, errors: { path?: string; message: string }[] = [], code?: string) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.code = code;
  }
}

export type Envelope<T> = { success: true; message: string; data: T; meta: Record<string, unknown> };

type RequestOptions = RequestInit & { retry?: boolean };

let refreshing: Promise<string | null> | null = null;

export function refreshAccess(): Promise<string | null> {
  if (!refreshing) {
    refreshing = fetch(`${base}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "x-session-id": useSession.getState().sessionId },
    })
      .then(async (response) => {
        if (!response.ok) {
          useSession.getState().clear();
          return null;
        }
        const body = (await response.json()) as Envelope<{ accessToken: string; user: SessionUser }>;
        useSession.getState().setAuth(body.data.accessToken, body.data.user);
        return body.data.accessToken;
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function api<T>(path: string, init: RequestOptions = {}): Promise<Envelope<T>> {
  const headers = new Headers(init.headers);
  const session = useSession.getState();
  if (session.accessToken) headers.set("authorization", `Bearer ${session.accessToken}`);
  if (session.sessionId) headers.set("x-session-id", session.sessionId);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${base}${path}`, { ...init, headers, credentials: "include" });
  if (response.status === 401 && !init.retry && !path.startsWith("/auth/")) {
    const token = await refreshAccess();
    if (token) return api<T>(path, { ...init, retry: true });
  }
  const text = await response.text();
  const body = text
    ? (JSON.parse(text) as { success?: boolean; message?: string; data?: T; meta?: Record<string, unknown>; errors?: { path?: string; message: string }[]; code?: string })
    : { success: false, message: "Empty response" };
  if (!response.ok || body.success === false) {
    throw new ApiError(body.message || "Request failed", response.status, body.errors || [], body.code);
  }
  return { success: true, message: body.message || "OK", data: body.data as T, meta: body.meta || {} };
}
