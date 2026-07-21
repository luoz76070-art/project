import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { once } from "node:events";
import net from "node:net";
import WebSocket from "ws";
import { resolveCodexExecutable } from "./codexExecutable.js";

type JsonRpcResponse<T = unknown> = {
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
};

export type AppServerClientOptions = {
  codexCommand?: string;
  port?: number;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
};

export class AppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<string | number, PendingRequest>();

  constructor(private readonly options: AppServerClientOptions = {}) {
    super();
  }

  async start(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;

    const port = this.options.port ?? (await getFreePort());
    const codexCommand = this.options.codexCommand ?? resolveCodexExecutable();
    const startupTimeoutMs = this.options.startupTimeoutMs ?? 30_000;

    this.child = spawnCodexAppServer(codexCommand, port);

    let stderr = "";
    let spawnErrorMessage: string | null = null;
    this.child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    this.child.once("error", (error) => {
      spawnErrorMessage = error.message;
      this.rejectAll(error);
    });

    this.child.once("exit", (code, signal) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`app-server exited before replying; code=${code} signal=${signal}`));
      }
      this.pending.clear();
    });

    const deadline = Date.now() + startupTimeoutMs;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      if (spawnErrorMessage) {
        throw new Error(`Failed to start Codex app-server with ${codexCommand}: ${spawnErrorMessage}`);
      }
      try {
        this.socket = await this.connect(`ws://127.0.0.1:${port}`, 1_500);
        this.socket.on("message", (data) => this.handleMessage(data.toString()));
        this.socket.on("close", () => this.rejectAll(new Error("app-server websocket closed")));
        this.socket.on("error", (error) => this.rejectAll(error));
        await this.initialize();
        return;
      } catch (error) {
        lastError = error;
        await delay(500);
      }
    }

    await this.stop();
    throw new Error(
      `Timed out starting app-server with ${codexCommand}. Last error: ${String(lastError)}. stderr: ${stderr.slice(-2000)}`,
    );
  }

  async stop(): Promise<void> {
    this.rejectAll(new Error("app-server client stopped"));
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    if (this.child && !this.child.killed) {
      this.child.kill();
      await Promise.race([once(this.child, "exit"), delay(2_000)]).catch(() => undefined);
    }
    this.child = null;
  }

  async request<T>(method: string, params: unknown = {}): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("app-server websocket is not open");
    }

    const id = this.nextId++;
    const requestTimeoutMs = this.options.requestTimeoutMs ?? 60_000;
    const payload = JSON.stringify({ id, method, params });

    const resultPromise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, requestTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
    });

    this.socket.send(payload);
    return resultPromise;
  }

  respond(id: string | number, result: unknown): void {
    this.sendServerResponse({ id, result });
  }

  respondError(id: string | number, code: number, message: string, data?: unknown): void {
    this.sendServerResponse({ id, error: { code, message, data } });
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "mobile-codex-relay",
        title: "Mobile Codex Relay",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
  }

  private connect(url: string, timeoutMs: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting to ${url}`));
      }, timeoutMs);

      socket.once("open", () => {
        clearTimeout(timeout);
        resolve(socket);
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private handleMessage(raw: string): void {
    let message: JsonRpcResponse & { method?: string; params?: unknown };
    try {
      message = JSON.parse(raw) as JsonRpcResponse & { method?: string; params?: unknown };
    } catch {
      return;
    }
    if (message.method) {
      this.emit("notification", { method: message.method, params: message.params, id: message.id });
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error) {
      pending.reject(new Error(`${message.error.message} (${message.error.code})`));
    } else {
      pending.resolve(message.result);
    }
  }

  private sendServerResponse(payload: JsonRpcResponse): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("app-server websocket is not open");
    }
    this.socket.send(JSON.stringify(payload));
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate local port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function spawnCodexAppServer(codexCommand: string, port: number): ChildProcessWithoutNullStreams {
  const args = ["app-server", "--listen", `ws://127.0.0.1:${port}`];
  if (process.platform === "win32" && isWindowsCommandShim(codexCommand)) {
    const shell = process.env.ComSpec ?? "cmd.exe";
    const commandLine = [quoteCmdArg(codexCommand), ...args.map(quoteCmdArg)].join(" ");
    return spawn(shell, ["/d", "/s", "/c", commandLine], {
      stdio: "pipe",
      windowsHide: true,
    });
  }

  return spawn(codexCommand, args, {
    stdio: "pipe",
    windowsHide: true,
  });
}

function isWindowsCommandShim(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command);
}

function quoteCmdArg(value: string): string {
  if (value.length > 0 && !/[\s"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}
