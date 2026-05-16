import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";

export type DesktopIpcEnvelope =
  | DesktopIpcBroadcast
  | DesktopIpcRequest
  | DesktopIpcResponse
  | DesktopIpcClientDiscoveryRequest
  | DesktopIpcClientDiscoveryResponse;

export type DesktopIpcBroadcast = {
  type: "broadcast";
  method: string;
  sourceClientId?: string;
  version?: number;
  params?: unknown;
};

export type DesktopIpcRequest = {
  type: "request";
  requestId: string;
  sourceClientId?: string;
  targetClientId?: string;
  method: string;
  version?: number;
  params?: unknown;
};

export type DesktopIpcResponse = {
  type: "response";
  requestId: string;
  resultType: "success" | "error";
  method?: string;
  handledByClientId?: string;
  result?: unknown;
  error?: string;
};

export type DesktopIpcClientDiscoveryRequest = {
  type: "client-discovery-request";
  requestId: string;
  request: DesktopIpcRequest;
};

export type DesktopIpcClientDiscoveryResponse = {
  type: "client-discovery-response";
  requestId: string;
  response: {
    canHandle: boolean;
  };
};

type PendingResponse = {
  resolve: (response: DesktopIpcResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type RequestHandler = {
  canHandle: (params: unknown, request: DesktopIpcRequest) => boolean | Promise<boolean>;
  handle: (request: DesktopIpcRequest) => unknown | Promise<unknown>;
};

export type DesktopIpcClientOptions = {
  clientType: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
};

export type DesktopIpcClientStatus = {
  connected: boolean;
  initialized: boolean;
  clientId: string | null;
  pipePath: string;
  lastError: string | null;
};

export class DesktopIpcClient {
  private readonly clientType: string;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private nextFrameLength: number | null = null;
  private clientId: string | null = null;
  private lastError: string | null = null;
  private pendingResponses = new Map<string, PendingResponse>();
  private requestHandlers = new Map<string, RequestHandler>();
  private anyMessageHandlers = new Set<(message: DesktopIpcEnvelope) => void>();

  constructor(options: DesktopIpcClientOptions) {
    this.clientType = options.clientType;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 3_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
  }

  getStatus(): DesktopIpcClientStatus {
    return {
      connected: Boolean(this.socket?.writable),
      initialized: this.clientId != null,
      clientId: this.clientId,
      pipePath: getDesktopIpcPipePath(),
      lastError: this.lastError,
    };
  }

  onAnyMessage(handler: (message: DesktopIpcEnvelope) => void): () => void {
    this.anyMessageHandlers.add(handler);
    return () => this.anyMessageHandlers.delete(handler);
  }

  addRequestHandler(method: string, handler: RequestHandler): () => void {
    this.requestHandlers.set(method, handler);
    return () => this.requestHandlers.delete(method);
  }

  async connect(): Promise<DesktopIpcClientStatus> {
    if (this.socket?.writable && this.clientId) return this.getStatus();

    await this.disconnect();
    this.lastError = null;
    const socket = net.createConnection(getDesktopIpcPipePath());
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("desktop-ipc-connect-timeout"));
      }, this.connectTimeoutMs);

      socket.once("connect", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    }).catch((error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      socket.destroy();
      this.socket = null;
      throw error;
    });

    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("error", (error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
    });
    socket.on("close", () => {
      this.socket = null;
      this.clientId = null;
      this.rejectPending(new Error("desktop-ipc-closed"));
    });

    const response = await this.sendRequest("initialize", { clientType: this.clientType }, { allowBeforeInitialize: true, version: 0 });
    if (response.resultType !== "success" || response.method !== "initialize") {
      throw new Error(response.error ?? "desktop-ipc-initialize-failed");
    }
    const result = response.result as { clientId?: unknown } | undefined;
    if (typeof result?.clientId !== "string" || result.clientId.length === 0) {
      throw new Error("desktop-ipc-initialize-missing-client-id");
    }
    this.clientId = result.clientId;
    return this.getStatus();
  }

  async disconnect(): Promise<void> {
    this.clientId = null;
    this.buffer = Buffer.alloc(0);
    this.nextFrameLength = null;
    this.rejectPending(new Error("desktop-ipc-disconnected"));
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.destroy();
    }
  }

  async sendRequest(
    method: string,
    params: unknown,
    options: { targetClientId?: string; allowBeforeInitialize?: boolean; version?: number } = {},
  ): Promise<DesktopIpcResponse> {
    const socket = this.socket;
    if (!socket?.writable) throw new Error("desktop-ipc-not-connected");
    if (!options.allowBeforeInitialize && !this.clientId) throw new Error("desktop-ipc-not-initialized");

    const requestId = randomUUID();
    const request: DesktopIpcRequest = {
      type: "request",
      requestId,
      sourceClientId: this.clientId ?? "initializing-client",
      method,
      version: options.version ?? 1,
      params,
      targetClientId: options.targetClientId,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        reject(new Error("desktop-ipc-request-timeout"));
      }, this.requestTimeoutMs);
      this.pendingResponses.set(requestId, { resolve, reject, timeout });
      writeFrame(socket, request);
    });
  }

  async sendBroadcast(method: string, params: unknown, version = 1): Promise<void> {
    const socket = this.socket;
    if (!socket?.writable) throw new Error("desktop-ipc-not-connected");
    if (!this.clientId) throw new Error("desktop-ipc-not-initialized");
    writeFrame(socket, {
      type: "broadcast",
      method,
      sourceClientId: this.clientId,
      version,
      params,
    });
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    for (;;) {
      if (this.nextFrameLength == null) {
        if (this.buffer.length < 4) return;
        this.nextFrameLength = this.buffer.readUInt32LE(0);
        this.buffer = this.buffer.subarray(4);
      }

      if (this.buffer.length < this.nextFrameLength) return;
      const payload = this.buffer.subarray(0, this.nextFrameLength);
      this.buffer = this.buffer.subarray(this.nextFrameLength);
      this.nextFrameLength = null;

      const message = JSON.parse(payload.toString("utf8")) as DesktopIpcEnvelope;
      this.handleMessage(message).catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  private async handleMessage(message: DesktopIpcEnvelope): Promise<void> {
    for (const handler of this.anyMessageHandlers) handler(message);

    if (message.type === "response") {
      const pending = this.pendingResponses.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pendingResponses.delete(message.requestId);
      pending.resolve(message);
      return;
    }

    if (message.type === "client-discovery-request") {
      await this.handleClientDiscoveryRequest(message);
      return;
    }

    if (message.type === "request") {
      await this.handleRequest(message);
    }
  }

  private async handleClientDiscoveryRequest(message: DesktopIpcClientDiscoveryRequest): Promise<void> {
    const socket = this.socket;
    if (!socket?.writable) return;
    const handler = this.requestHandlers.get(message.request.method);
    if (!handler) {
      writeFrame(socket, {
        type: "client-discovery-response",
        requestId: message.requestId,
        response: { canHandle: false },
      });
      return;
    }

    const canHandle = await handler.canHandle(message.request.params, message.request);
    writeFrame(socket, {
      type: "client-discovery-response",
      requestId: message.requestId,
      response: { canHandle },
    });
  }

  private async handleRequest(request: DesktopIpcRequest): Promise<void> {
    const socket = this.socket;
    if (!socket?.writable) return;
    const handler = this.requestHandlers.get(request.method);
    if (!handler) {
      writeFrame(socket, {
        type: "response",
        requestId: request.requestId,
        resultType: "error",
        error: "no-handler-for-request",
      });
      return;
    }

    try {
      const result = await handler.handle(request);
      writeFrame(socket, {
        type: "response",
        requestId: request.requestId,
        resultType: "success",
        method: request.method,
        handledByClientId: this.clientId ?? undefined,
        result,
      });
    } catch (error) {
      writeFrame(socket, {
        type: "response",
        requestId: request.requestId,
        resultType: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private rejectPending(error: Error): void {
    for (const [requestId, pending] of this.pendingResponses.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingResponses.delete(requestId);
    }
  }
}

export function getDesktopIpcPipePath(): string {
  if (process.platform === "win32") return path.join("\\\\.\\pipe", "codex-ipc");
  return path.join("/tmp", "codex-ipc", typeof process.getuid === "function" ? `ipc-${process.getuid()}.sock` : "ipc.sock");
}

function writeFrame(socket: net.Socket, message: DesktopIpcEnvelope): void {
  const json = JSON.stringify(message);
  const payloadLength = Buffer.byteLength(json, "utf8");
  const frame = Buffer.alloc(4 + payloadLength);
  frame.writeUInt32LE(payloadLength, 0);
  frame.write(json, 4, "utf8");
  socket.write(frame);
}
