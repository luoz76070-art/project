import path from "node:path";
import { z } from "zod";
import { agentError } from "./sessions.js";

export const openCodeConfigSchema = z.object({
  url: z.string().max(2048).refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)
        && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
    } catch { return false; }
  }),
  directory: z.string().max(4096).refine(value => path.isAbsolute(value)),
  username: z.string().min(1).max(256).refine(value => !/[:\r\n]/u.test(value)).default("opencode"),
  password: z.string().min(1).max(4096).optional(),
}).strict();
export type OpenCodeConfig = z.input<typeof openCodeConfigSchema>;
const eventSchema = z.object({ id: z.string().max(256), type: z.string().max(256), created: z.number().finite().min(0).max(8.64e15).optional(), data: z.record(z.string(), z.unknown()).optional() });
export type OpenCodeEvent = z.infer<typeof eventSchema>;

/** Bounded HTTP/SSE for an explicitly configured loopback server, with no redirects or retries. */
export class OpenCodeClient {
  readonly config: z.output<typeof openCodeConfigSchema>;
  private readonly requests = new Set<AbortController>();
  private stopped = false;
  private readonly timeoutMs: number;
  private readonly idleMs: number;

  constructor(config: OpenCodeConfig, options: { timeoutMs?: number; idleMs?: number } = {}) {
    const parsed = openCodeConfigSchema.safeParse(config);
    if (!parsed.success) throw agentError("OPENCODE_CONFIG_INVALID", 400);
    this.config = parsed.data;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.idleMs = options.idleMs ?? 30_000;
  }

  async json<T>(route: string, schema: z.ZodType<T>, body?: unknown, method?: "GET" | "POST"): Promise<T> {
    const controller = this.reserve();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url(route), {
        method: method ?? (body === undefined ? "GET" : "POST"), redirect: "error", signal: controller.signal,
        headers: this.headers(body !== undefined), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw this.responseError(response.status);
      let value: unknown = undefined;
      if (response.status !== 204) {
        if (!response.headers.get("content-type")?.includes("application/json")) throw agentError("OPENCODE_PROTOCOL_ERROR");
        const reader = response.body?.getReader();
        if (!reader) throw agentError("OPENCODE_PROTOCOL_ERROR");
        const chunks: Uint8Array[] = []; let size = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 4 * 1024 * 1024) throw agentError("OPENCODE_RESPONSE_TOO_LARGE");
          chunks.push(chunk.value);
        }
        try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { throw agentError("OPENCODE_PROTOCOL_ERROR"); }
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) throw agentError("OPENCODE_PROTOCOL_ERROR");
      return parsed.data;
    } catch (error) { throw this.normalize(error); }
    finally { clearTimeout(timer); controller.abort(); this.requests.delete(controller); }
  }

  /** Resolves only after the server's connected event; caller owns reconnect policy. */
  events(onEvent: (event: OpenCodeEvent) => void, onDisconnect: () => void): Promise<() => void> {
    const controller = this.reserve();
    let closed = false, connected = false, settled = false;
    let timer: NodeJS.Timeout;
    const reset = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), ms); };
    reset(this.timeoutMs);
    const close = () => { closed = true; clearTimeout(timer); controller.abort(); this.requests.delete(controller); };
    return new Promise((resolve, reject) => {
      void (async () => {
        try {
          const response = await fetch(this.url("/api/event"), { redirect: "error", headers: { ...this.headers(false), Accept: "text/event-stream" }, signal: controller.signal });
          if (!response.ok) throw this.responseError(response.status);
          if (!response.headers.get("content-type")?.startsWith("text/event-stream") || !response.body) throw agentError("OPENCODE_PROTOCOL_ERROR");
          const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
          let buffer = "", frameBytes = 0;
          while (!closed) {
            const chunk = await reader.read();
            if (chunk.done) throw agentError("OPENCODE_DISCONNECTED");
            if (connected) reset(this.idleMs);
            frameBytes += chunk.value.length;
            if (frameBytes > 2 * 1024 * 1024) throw agentError("OPENCODE_RESPONSE_TOO_LARGE");
            buffer += decoder.decode(chunk.value, { stream: true });
            let end: number;
            while ((end = buffer.search(/\r?\n\r?\n/u)) !== -1) {
              const boundary = buffer.slice(end).match(/^\r?\n\r?\n/u)![0].length;
              const frame = buffer.slice(0, end); buffer = buffer.slice(end + boundary);
              frameBytes = Buffer.byteLength(buffer);
              const data = frame.split(/\r?\n/u).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /u, "")).join("\n");
              if (!data) continue;
              const parsed = eventSchema.safeParse(JSON.parse(data));
              if (!parsed.success) throw agentError("OPENCODE_PROTOCOL_ERROR");
              if (!connected) {
                if (parsed.data.type !== "server.connected") throw agentError("OPENCODE_PROTOCOL_ERROR");
                connected = settled = true; reset(this.idleMs); resolve(close);
              }
              onEvent(parsed.data);
            }
          }
        } catch (error) {
          if (!settled) { settled = true; reject(this.normalize(error)); }
          else if (!closed) onDisconnect();
        } finally { close(); }
      })();
    });
  }

  stop() { this.stopped = true; for (const controller of this.requests) controller.abort(); this.requests.clear(); }

  private reserve() {
    if (this.stopped) throw agentError("OPENCODE_STOPPED", 503);
    if (this.requests.size >= 16) throw agentError("OPENCODE_BUSY", 429);
    const controller = new AbortController(); this.requests.add(controller); return controller;
  }
  private url(route: string) { return new URL(route, this.config.url); }
  private headers(json: boolean): Record<string, string> {
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(this.config.password ? { Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}` } : {}),
    };
  }
  private responseError(status: number) {
    return agentError(status === 401 || status === 403 ? "OPENCODE_AUTH_FAILED" : status === 404 ? "OPENCODE_NOT_FOUND_OR_UNSUPPORTED" : status === 409 ? "OPENCODE_CONFLICT" : "OPENCODE_REQUEST_REJECTED", status === 409 ? 409 : 502);
  }
  private normalize(error: unknown) {
    return error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("OPENCODE_")
      ? error : agentError(this.stopped ? "OPENCODE_STOPPED" : "OPENCODE_CONNECTION_FAILED");
  }
}
