const endpoint = process.env.MOBILE_CODEX_SMOKE_ENDPOINT ?? "http://127.0.0.1:8787";
const token = process.env.MOBILE_CODEX_TOKEN ?? "change-me";

type LiveTurnSnapshot = {
  threadId: string;
  turnId: string;
  status: "starting" | "inProgress" | "completed" | "interrupted" | "failed";
  messageCount: number;
  eventCount: number;
  messages: Array<{ role: string; text: string; kind: string }>;
  error: string | null;
};

const started = await post<LiveTurnSnapshot>("/api/live/turns", {
  message: [
    "Mobile Codex live control smoke test.",
    "Please think briefly, then reply with exactly: CONTROL_SMOKE_READY.",
    "Do not modify files.",
  ].join(" "),
  cwd: process.cwd(),
});

await delay(1200);

let beforeInterrupt = await get<{ turn: LiveTurnSnapshot | null }>(`/api/live/turns/${encodeURIComponent(started.turnId)}`);

let steerAccepted = false;
try {
  await post<{ turn: LiveTurnSnapshot | null }>(`/api/live/turns/${encodeURIComponent(started.turnId)}/steer`, {
    threadId: started.threadId,
    message: "Smoke steer: if this is accepted, include CONTROL_STEER_SEEN in the final answer.",
  });
  steerAccepted = true;
} catch {
  steerAccepted = false;
}

await delay(500);

let interruptAccepted = false;
try {
  await post<{ turn: LiveTurnSnapshot | null }>(`/api/live/turns/${encodeURIComponent(started.turnId)}/interrupt`, {
    threadId: started.threadId,
  });
  interruptAccepted = true;
} catch {
  interruptAccepted = false;
}

await delay(1500);

const afterInterrupt = await get<{ turn: LiveTurnSnapshot | null }>(`/api/live/turns/${encodeURIComponent(started.turnId)}`);

console.log(
  JSON.stringify(
    {
      endpoint,
      threadId: started.threadId,
      turnId: started.turnId,
      startStatus: started.status,
      beforeInterruptStatus: beforeInterrupt.turn?.status ?? null,
      afterInterruptStatus: afterInterrupt.turn?.status ?? null,
      messageCount: afterInterrupt.turn?.messageCount ?? 0,
      eventCount: afterInterrupt.turn?.eventCount ?? 0,
      steerAccepted,
      interruptAccepted,
      error: afterInterrupt.turn?.error ?? null,
      lastMessage: afterInterrupt.turn?.messages.at(-1)?.text.slice(0, 240) ?? null,
    },
    null,
    2,
  ),
);

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${endpoint}${path}`, {
    headers: authHeaders(),
  });
  await ensureOk(response);
  return (await response.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  await ensureOk(response);
  return (await response.json()) as T;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function ensureOk(response: Response) {
  if (response.ok) return;
  throw new Error(`HTTP ${response.status}: ${await response.text()}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
