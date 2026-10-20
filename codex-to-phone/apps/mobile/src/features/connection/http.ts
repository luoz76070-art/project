import { type RequestJsonOptions } from "../../app/types";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

export async function apiGet<T>(url: string, token?: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(url, {
    headers: token ? authHeaders(token) : undefined,
    signal,
    connectTimeout: 8000,
    readTimeout: 60000,
  });
}

export async function apiPost<T>(url: string, token: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    signal,
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body,
    connectTimeout: 8000,
    readTimeout: 180000,
  });
}

export async function requestJson<T>(url: string, options: RequestJsonOptions = {}): Promise<T> {
  options.signal?.throwIfAborted();
  const normalizedUrl = normalizeUrl(url);
  assertSecureEndpoint(normalizedUrl);
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url: normalizedUrl,
      method: options.method ?? "GET",
      headers: options.headers,
      data: options.body,
      connectTimeout: options.connectTimeout,
      readTimeout: options.readTimeout,
      responseType: "json",
      disableRedirects: true,
    });
    options.signal?.throwIfAborted();
    ensureHttpOk(response.status);
    return parseJsonData<T>(response.data);
  }

  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("HTTP request timeout")), options.readTimeout ?? 60000);
  try {
    const response = await fetch(normalizedUrl, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    ensureHttpOk(response.status);
    const result = await response.json() as T;
    options.signal?.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function parseJsonData<T>(data: unknown): T {
  if (typeof data === "string") {
    return JSON.parse(data) as T;
  }
  return data as T;
}

export function ensureHttpOk(status: number) {
  if (status >= 200 && status < 300) return;
  throw Object.assign(new Error(status === 401 ? "HTTP 401 token 不正确" : `HTTP ${status}`), { status });
}

export function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function buildUrl(endpoint: string, path: string) {
  return `${normalizeEndpoint(endpoint)}${path}`;
}

export function normalizeEndpoint(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function normalizeUrl(value: string) {
  return value.trim();
}

export function toFriendlyFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "Failed to fetch" || message.includes("ConnectException") || message.includes("ECONNREFUSED")) {
    return "连接失败：确认电脑 Relay 正在运行，手机和电脑同一网络，防火墙放行 8787";
  }
  if (message.includes("timeout") || message.includes("Timed out")) {
    return "连接超时：Relay 或 Codex app-server 响应太慢，请重试";
  }
  return message;
}


export function assertSecureEndpoint(endpoint: string) {
  const url = new URL(normalizeEndpoint(endpoint));
  const host = url.hostname.toLowerCase();
  const ipv4 = host.split(".").map(Number);
  const privateV4 = ipv4.length === 4 && ipv4.every(part => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (ipv4[0] === 127 || ipv4[0] === 10 || (ipv4[0] === 192 && ipv4[1] === 168) || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) || (ipv4[0] === 169 && ipv4[1] === 254));
  const privateHost = host === "localhost" || host.endsWith(".local") || host === "[::1]" || /^\[(fc|fd|fe80:)/.test(host) || privateV4;
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && privateHost))) {
    throw new Error("公网连接需要 HTTPS；局域网和本机可使用 HTTP");
  }
}
