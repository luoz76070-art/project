import { EventEmitter } from "node:events";
import net from "node:net";
import path from "node:path";
import WebSocket from "ws";
import { z } from "zod";

const maxFrameBytes = 4 * 1024 * 1024;
const envelopeSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().max(256).optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
const loadedSchema = z.object({
  data: z.array(z.string()).max(100),
  nextCursor: z.string().nullable().optional(),
});

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type LocalAppServerOptions = { socketPath: string; timeoutMs?: number; heartbeatMs?: number };

export function localAppServerError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

/** Owns a WebSocket connection to an existing daemon, never the daemon or a turn. */
export class LocalAppServerClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private opening: { socket: WebSocket; reject: (error: Error) => void } | null = null;
  private connecting: Promise<void> | null = null;
  private ready = false;
  private generation = 0;
  private nextId = 1;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly pending = new Map<string | number, Pending>();
  private readonly closing = new Map<WebSocket, Promise<void>>();

  constructor(private readonly options: LocalAppServerOptions) {
    super();
    if (!path.isAbsolute(options.socketPath)) throw localAppServerError("CODEX_SOCKET_PATH_REQUIRED");
  }

  isConnected(): boolean {
    return this.ready && this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    if (this.isConnected()) return Promise.resolve();
    if (this.connecting) return this.connecting;
    if (this.socket) this.fail(this.socket, localAppServerError("CODEX_SOCKET_DISCONNECTED"));
    const attempt = this.open(++this.generation);
    const tracked = attempt.finally(() => { if (this.connecting === tracked) this.connecting = null; });
    this.connecting = tracked;
    return tracked;
  }

  async loadedThreadSummary(): Promise<{ count: number; hasMore: boolean }> {
    const socket = this.socket;
    if (!socket || !this.isConnected()) throw localAppServerError("CODEX_SOCKET_NOT_CONNECTED");
    const result = await this.rpc("thread/loaded/list", { limit: 100 });
    const parsed = loadedSchema.safeParse(result);
    if (!parsed.success) {
      const error = localAppServerError("CODEX_SOCKET_PROTOCOL_ERROR");
      this.fail(socket, error);
      throw error;
    }
    // IDs remain local to this decoder. Neither the API nor the probe prints them.
    return { count: parsed.data.data.length, hasMore: Boolean(parsed.data.nextCursor) };
  }

  async stop(): Promise<void> {
    ++this.generation;
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    this.clearHeartbeat();
    this.connecting = null;
    const error = localAppServerError("CODEX_SOCKET_STOPPED");
    this.opening?.reject(error);
    this.rejectPending(error);
    if (socket) await this.dispose(socket);
    await Promise.all(this.closing.values());
  }

  private async open(generation: number): Promise<void> {
    // The Unix control socket speaks WebSocket, including the HTTP Upgrade handshake.
    const socket = new WebSocket("ws://localhost/", {
      createConnection: () => net.createConnection({ path: this.options.socketPath }),
      maxPayload: maxFrameBytes,
      perMessageDeflate: false,
    });
    this.socket = socket;
    socket.on("message", (data, isBinary) => {
      if (this.socket !== socket) return;
      if (isBinary) { this.fail(socket, localAppServerError("CODEX_SOCKET_PROTOCOL_ERROR")); return; }
      this.handleMessage(socket, data.toString());
    });
    socket.on("error", (error: Error & { code?: string }) => this.fail(socket, localAppServerError(
      error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH" ? "CODEX_SOCKET_FRAME_TOO_LARGE"
        : error.code?.startsWith("WS_ERR_") ? "CODEX_SOCKET_PROTOCOL_ERROR" : "CODEX_SOCKET_CONNECTION_FAILED",
    )));
    socket.on("close", () => this.fail(socket, localAppServerError("CODEX_SOCKET_DISCONNECTED")));
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          socket.removeListener("open", opened);
          if (this.opening?.socket === socket) this.opening = null;
        };
        const opened = () => { cleanup(); resolve(); };
        const timer = setTimeout(() => this.fail(socket, localAppServerError("CODEX_SOCKET_TIMEOUT")), this.options.timeoutMs ?? 8_000);
        this.opening = { socket, reject: error => { cleanup(); reject(error); } };
        socket.once("open", opened);
      });
      if (generation !== this.generation || this.socket !== socket) throw localAppServerError("CODEX_SOCKET_STOPPED");
      const result = await this.rpc("initialize", {
        clientInfo: { name: "mobile-codex-existing-server-probe", version: "0.1.0" },
        capabilities: { experimentalApi: false },
      });
      if (!z.object({ userAgent: z.string() }).safeParse(result).success) throw localAppServerError("CODEX_SOCKET_PROTOCOL_ERROR");
      if (generation !== this.generation || this.socket !== socket) throw localAppServerError("CODEX_SOCKET_STOPPED");
      this.write(socket, { method: "initialized", params: {} });
      this.ready = true;
      let alive = true;
      socket.on("pong", () => { alive = true; });
      this.heartbeat = setInterval(() => {
        if (this.socket !== socket) return;
        if (!alive) { this.fail(socket, localAppServerError("CODEX_SOCKET_UNRESPONSIVE")); return; }
        alive = false;
        socket.ping(undefined, undefined, error => {
          if (error) this.fail(socket, localAppServerError("CODEX_SOCKET_DISCONNECTED"));
        });
      }, this.options.heartbeatMs ?? 15_000);
      this.heartbeat.unref();
    } catch (error) {
      this.fail(socket, error instanceof Error ? error : localAppServerError("CODEX_SOCKET_PROTOCOL_ERROR"));
      await this.dispose(socket);
      throw error;
    }
  }

  private rpc(method: "initialize" | "thread/loaded/list", params: unknown): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(localAppServerError("CODEX_SOCKET_NOT_CONNECTED"));
    if (this.pending.size >= 16) return Promise.reject(localAppServerError("CODEX_SOCKET_BUSY"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(socket, localAppServerError("CODEX_SOCKET_TIMEOUT")), this.options.timeoutMs ?? 8_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write(socket, { id, method, params }); }
      catch { this.fail(socket, localAppServerError("CODEX_SOCKET_DISCONNECTED")); }
    });
  }

  private write(socket: WebSocket, message: unknown): void {
    if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) throw localAppServerError("CODEX_SOCKET_DISCONNECTED");
    socket.send(JSON.stringify(message), error => {
      if (error) this.fail(socket, localAppServerError("CODEX_SOCKET_DISCONNECTED"));
    });
  }

  private handleMessage(socket: WebSocket, raw: string): void {
    let message: z.infer<typeof envelopeSchema>;
    try { message = envelopeSchema.parse(JSON.parse(raw)); }
    catch { this.fail(socket, localAppServerError("CODEX_SOCKET_PROTOCOL_ERROR")); return; }
    // This client owns no turn. Do not answer another client's approval or tool request.
    if (message.method) return;
    if (message.id === undefined || (!message.error && !Object.hasOwn(message, "result"))) {
      this.fail(socket, localAppServerError("CODEX_SOCKET_PROTOCOL_ERROR")); return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(localAppServerError("CODEX_SOCKET_RPC_REJECTED"));
    else pending.resolve(message.result);
  }

  private fail(socket: WebSocket, error: Error): void {
    if (this.socket !== socket) return;
    const wasReady = this.ready;
    this.socket = null;
    this.ready = false;
    this.clearHeartbeat();
    if (this.opening?.socket === socket) this.opening.reject(error);
    this.rejectPending(error);
    void this.dispose(socket);
    if (wasReady) this.emit("disconnect", error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private dispose(socket: WebSocket): Promise<void> {
    const existing = this.closing.get(socket);
    if (existing) return existing;
    if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    const pending = new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); socket.removeListener("close", done); resolve(); };
      const timer = setTimeout(done, 500);
      socket.once("close", done);
      socket.terminate();
    }).finally(() => this.closing.delete(socket));
    this.closing.set(socket, pending);
    return pending;
  }
}
