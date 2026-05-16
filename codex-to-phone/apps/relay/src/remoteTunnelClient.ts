import WebSocket from "ws";

type BrokerRequest = {
  type: "request";
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
};

type BrokerResponse = {
  type: "response";
  id: string;
  status: number;
  headers: Record<string, string>;
  body: string;
};

const config = {
  brokerUrl: process.env.MOBILE_CODEX_BROKER_URL ?? "",
  relayId: process.env.MOBILE_CODEX_RELAY_ID ?? "",
  relaySecret: process.env.MOBILE_CODEX_RELAY_SECRET ?? "",
  localRelay: process.env.MOBILE_CODEX_LOCAL_RELAY ?? "http://127.0.0.1:8787",
  reconnectMs: Number(process.env.MOBILE_CODEX_TUNNEL_RECONNECT_MS ?? 3_000),
  requestTimeoutMs: Number(process.env.MOBILE_CODEX_TUNNEL_REQUEST_TIMEOUT_MS ?? 180_000),
};

if (!config.brokerUrl || !config.relayId || !config.relaySecret) {
  console.error("Set MOBILE_CODEX_BROKER_URL, MOBILE_CODEX_RELAY_ID and MOBILE_CODEX_RELAY_SECRET.");
  process.exit(2);
}

for (;;) {
  try {
    await connectOnce();
  } catch (error) {
    console.error(`[remote-tunnel] ${toErrorMessage(error)}`);
  }
  await delay(config.reconnectMs);
}

function connectOnce(): Promise<void> {
  const url = buildBrokerWebSocketUrl(config.brokerUrl, config.relayId, config.relaySecret);
  console.log(`[remote-tunnel] connecting ${redactSecret(url)}`);
  const socket = new WebSocket(url);

  return new Promise((resolve, reject) => {
    socket.once("open", () => {
      console.log(`[remote-tunnel] connected relayId=${config.relayId}`);
    });
    socket.once("error", reject);
    socket.once("close", (code, reason) => {
      console.log(`[remote-tunnel] closed code=${code} reason=${reason.toString()}`);
      resolve();
    });
    socket.on("message", (data) => {
      void handleRequest(socket, data.toString());
    });
  });
}

async function handleRequest(socket: WebSocket, raw: string): Promise<void> {
  let request: BrokerRequest;
  try {
    request = JSON.parse(raw) as BrokerRequest;
  } catch {
    return;
  }
  if (request.type !== "request" || typeof request.id !== "string") return;

  const response = await forwardLocal(request).catch((error): BrokerResponse => ({
    type: "response",
    id: request.id,
    status: 502,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ error: "local_relay_failed", message: toErrorMessage(error) }),
  }));

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(response));
  }
}

async function forwardLocal(request: BrokerRequest): Promise<BrokerResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(new URL(request.path, config.localRelay), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    return {
      type: "response",
      id: request.id,
      status: response.status,
      headers: normalizeResponseHeaders(response.headers),
      body: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildBrokerWebSocketUrl(raw: string, relayId: string, secret: string): string {
  const url = new URL(raw);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  const pathname = url.pathname.replace(/\/+$/u, "");
  if (!pathname) {
    url.pathname = "/relay/connect";
  } else if (!pathname.endsWith("/relay/connect")) {
    url.pathname = `${pathname}/relay/connect`;
  }
  url.searchParams.set("relayId", relayId);
  url.searchParams.set("secret", secret);
  return url.toString();
}

function normalizeResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower === "content-length" || lower === "connection" || lower === "transfer-encoding") return;
    result[name] = value;
  });
  return result;
}

function redactSecret(value: string): string {
  return value.replace(/secret=[^&]+/u, "secret=***");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
