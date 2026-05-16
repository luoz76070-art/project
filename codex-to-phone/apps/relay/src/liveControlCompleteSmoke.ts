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
  message: "Mobile Codex complete smoke. Reply exactly: CONTROL_COMPLETE_OK. Do not run tools or modify files.",
  cwd: process.cwd(),
});

let snapshot = started;
const deadline = Date.now() + 120_000;
while ((snapshot.status === "starting" || snapshot.status === "inProgress") && Date.now() < deadline) {
  await delay(1000);
  const response = await get<{ turn: LiveTurnSnapshot | null }>(`/api/live/turns/${encodeURIComponent(started.turnId)}`);
  if (!response.turn) throw new Error("turn not found");
  snapshot = response.turn;
}

const assistantText = snapshot.messages
  .filter((message) => message.role === "assistant")
  .map((message) => message.text)
  .join("\n")
  .trim();

if (snapshot.status !== "completed") {
  throw new Error(`Expected completed, got ${snapshot.status}: ${snapshot.error ?? ""}`);
}
if (!assistantText.includes("CONTROL_COMPLETE_OK")) {
  throw new Error(`Expected CONTROL_COMPLETE_OK in assistant text, got: ${assistantText.slice(0, 500)}`);
}

console.log(
  JSON.stringify(
    {
      endpoint,
      threadId: started.threadId,
      turnId: started.turnId,
      status: snapshot.status,
      messageCount: snapshot.messageCount,
      eventCount: snapshot.eventCount,
      assistantText,
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
