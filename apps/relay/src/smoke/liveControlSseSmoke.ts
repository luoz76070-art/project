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
  message: "Mobile Codex SSE smoke. Reply exactly: SSE_STREAM_OK. Do not run tools or modify files.",
  cwd: process.cwd(),
});

const tokenResponse = await post<{ streamToken: string | null; expiresAt?: string; error?: string }>(
  `/api/live/turns/${encodeURIComponent(started.turnId)}/stream-token`,
  {},
);
if (!tokenResponse.streamToken) throw new Error(tokenResponse.error ?? "stream token not available");

const snapshots: LiveTurnSnapshot[] = [];
const response = await fetch(
  `${endpoint}/api/live/turns/${encodeURIComponent(started.turnId)}/events?streamToken=${encodeURIComponent(tokenResponse.streamToken)}`,
);
if (!response.ok || !response.body) {
  throw new Error(`SSE connect failed: HTTP ${response.status}`);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
const deadline = Date.now() + 120_000;

try {
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith("data: "));
      if (!dataLine || frame.includes("event: ping")) continue;
      const snapshot = JSON.parse(dataLine.slice("data: ".length)) as LiveTurnSnapshot;
      snapshots.push(snapshot);
      if (snapshot.status === "completed") {
        const assistantText = snapshot.messages
          .filter((message) => message.role === "assistant")
          .map((message) => message.text)
          .join("\n");
        if (!assistantText.includes("SSE_STREAM_OK")) {
          throw new Error(`Missing SSE_STREAM_OK, got ${assistantText.slice(0, 300)}`);
        }
        console.log(
          JSON.stringify(
            {
              endpoint,
              threadId: snapshot.threadId,
              turnId: snapshot.turnId,
              status: snapshot.status,
              snapshots: snapshots.length,
              messageCount: snapshot.messageCount,
              eventCount: snapshot.eventCount,
              assistantText,
            },
            null,
            2,
          ),
        );
        process.exit(0);
      }
    }
  }
  throw new Error(`Timed out waiting for completed SSE snapshot; received=${snapshots.length}`);
} finally {
  await reader.cancel().catch(() => undefined);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}
