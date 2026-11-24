// Low-level typed HTTP client with token handling and central 401 handling.

const TOKEN_KEY = "devpilot.token";

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) || "/api/v1";

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

type UnauthorizedHandler = () => void;

function defaultUnauthorized(): void {
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

let unauthorizedHandler: UnauthorizedHandler = defaultUnauthorized;

/** Override what happens on 401 (default: redirect to /login). Returns a restore function. */
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): () => void {
  const prev = unauthorizedHandler;
  unauthorizedHandler = fn ?? defaultUnauthorized;
  return () => {
    unauthorizedHandler = prev;
  };
}

/** Turn a FastAPI-style `detail` (string | validation list) into a human message. */
export function formatDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((d) => {
      if (d && typeof d === "object") {
        const o = d as { loc?: unknown[]; msg?: string };
        const loc = Array.isArray(o.loc) ? o.loc.filter((x) => x !== "body").join(".") : "";
        return loc ? `${loc}: ${o.msg ?? "invalid"}` : (o.msg ?? "invalid");
      }
      return String(d);
    });
    return parts.join("; ") || fallback;
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return fallback;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Do not trigger the global 401 handler (used by login/register). */
  noAuthRedirect?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  let url = `${API_BASE}${path}`;
  if (query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
    }
    const qs = sp.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

export async function request<T>(
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), { method, headers, body, signal: opts.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "Network error: could not reach the DevPilot API.");
  }

  if (res.status === 401 && !opts.noAuthRedirect) {
    setToken(null);
    unauthorizedHandler();
    throw new ApiError(401, "Session expired. Please sign in again.");
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const detail = data && typeof data === "object" ? (data as { detail?: unknown }).detail : data;
    throw new ApiError(
      res.status,
      formatDetail(detail, `Request failed (HTTP ${res.status})`),
      detail,
    );
  }
  return data as T;
}

export const http = {
  get: <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal) =>
    request<T>("GET", path, { query, signal }),
  post: <T>(path: string, body?: unknown, extra?: Pick<RequestOptions, "noAuthRedirect">) =>
    request<T>("POST", path, { body: body ?? {}, ...extra }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  delete: <T = void>(path: string) => request<T>("DELETE", path),
};

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
