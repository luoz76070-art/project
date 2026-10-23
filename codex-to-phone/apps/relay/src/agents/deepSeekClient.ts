import type { z } from "zod";
import { deepSeekConfigSchema, deepSeekSnapshot, type DeepSeekConfig } from "./deepSeekProtocol.js";
import { agentError, type AgentSessionSnapshot } from "./sessions.js";

/** Private loopback bridge in the original dsh process; no redirects, replay or process creation. */
export class DeepSeekClient {
  readonly config: DeepSeekConfig;
  private requests = new Set<AbortController>();
  private stopped = false;
  constructor(config: DeepSeekConfig, private readonly options: { timeoutMs?: number; idleMs?: number } = {}) {
    const parsed = deepSeekConfigSchema.safeParse(config);
    if (!parsed.success) throw agentError("DEEPSEEK_CONFIG_INVALID", 400);
    this.config = parsed.data;
  }
  private reserve() {
    if (this.stopped) throw agentError("DEEPSEEK_STOPPED", 503);
    if (this.requests.size >= 16) throw agentError("DEEPSEEK_BUSY", 429);
    const controller = new AbortController(); this.requests.add(controller); return controller;
  }
  private headers(json = false) { return { Authorization: `Bearer ${this.config.token}`, ...(json ? { "Content-Type": "application/json" } : {}) }; }
  private async response(route: string, controller: AbortController, body?: unknown) {
    const response = await fetch(new URL(route, this.config.url), { method: body === undefined ? "GET" : "POST", redirect: "error", signal: controller.signal,
      headers: this.headers(body !== undefined), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw agentError(response.status === 403 ? "DEEPSEEK_AUTH_FAILED" : response.status === 409 ? "DEEPSEEK_CONFLICT" : response.status === 410 ? "DEEPSEEK_SESSION_GONE" : "DEEPSEEK_REQUEST_REJECTED", [400, 403, 404, 409, 410, 429].includes(response.status) ? response.status : 502);
    return response;
  }
  private normalize(error: unknown) {
    return error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("DEEPSEEK_") ? error : agentError(this.stopped ? "DEEPSEEK_STOPPED" : "DEEPSEEK_CONNECTION_FAILED");
  }
  async json<T>(route: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const controller = this.reserve(), timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8000);
    try {
      const response = await this.response(route, controller, body);
      if (!response.headers.get("content-type")?.includes("application/json") || !response.body) throw agentError("DEEPSEEK_PROTOCOL_ERROR");
      const chunks: Uint8Array[] = []; let bytes = 0;
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 1024 * 1024) throw agentError("DEEPSEEK_RESPONSE_TOO_LARGE"); chunks.push(chunk); }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      const parsed = schema.safeParse(value);
      if (!parsed.success) throw agentError("DEEPSEEK_PROTOCOL_ERROR");
      return parsed.data;
    } catch (error) { throw this.normalize(error); }
    finally { clearTimeout(timer); controller.abort(); this.requests.delete(controller); }
  }
  events(sessionId: string, receive: (snapshot: AgentSessionSnapshot) => void, disconnect: () => void): Promise<() => void> {
    const controller = this.reserve(); let closed = false, settled = false, timer: NodeJS.Timeout;
    let directory: string | undefined;
    const reset = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), ms); };
    const close = () => { closed = true; clearTimeout(timer); controller.abort(); this.requests.delete(controller); };
    reset(this.options.timeoutMs ?? 8000);
    return new Promise((resolve, reject) => {
      void (async () => {
        try {
          const response = await this.response(`/sessions/${encodeURIComponent(sessionId)}/events`, controller);
          if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) throw agentError("DEEPSEEK_PROTOCOL_ERROR");
          const decoder = new TextDecoder("utf-8", { fatal: true }); let buffer = "";
          for await (const chunk of response.body) {
            if (settled) reset(this.options.idleMs ?? 30000);
            buffer += decoder.decode(chunk, { stream: true });
            if (Buffer.byteLength(buffer) > 1024 * 1024) throw agentError("DEEPSEEK_RESPONSE_TOO_LARGE");
            let end: number;
            while ((end = buffer.indexOf("\n\n")) >= 0) {
              const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
              const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
              if (!data) continue;
              const parsed = deepSeekSnapshot.safeParse(JSON.parse(data));
              if (!parsed.success || parsed.data.session.id !== sessionId
                || (this.config.scope !== "all" && parsed.data.session.directory !== this.config.directory)
                || (directory !== undefined && parsed.data.session.directory !== directory)) throw agentError("DEEPSEEK_PROTOCOL_ERROR");
              directory = parsed.data.session.directory;
              receive(parsed.data);
              if (!settled) { settled = true; reset(this.options.idleMs ?? 30000); resolve(close); }
            }
          }
          throw agentError("DEEPSEEK_DISCONNECTED");
        } catch (error) { if (!settled) reject(this.normalize(error)); else if (!closed) disconnect(); }
        finally { close(); }
      })();
    });
  }
  stop() { this.stopped = true; for (const controller of this.requests) controller.abort(); this.requests.clear(); }
}
