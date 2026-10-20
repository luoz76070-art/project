const endpoint = process.env.MOBILE_CODEX_SMOKE_ENDPOINT ?? "http://127.0.0.1:8787";
const token = process.env.MOBILE_CODEX_TOKEN ?? "change-me";

type LiveApproval = {
  id: string;
  kind: string;
  status: "pending" | "approved" | "declined" | "cancelled" | "failed";
  title: string;
  detail: string;
};

type LiveTurnSnapshot = {
  threadId: string;
  turnId: string;
  status: "starting" | "inProgress" | "completed" | "interrupted" | "failed";
  messageCount: number;
  eventCount: number;
  approvals: LiveApproval[];
  messages: Array<{ role: string; text: string; kind: string }>;
  error: string | null;
};

const started = await post<LiveTurnSnapshot>("/api/live/turns", {
  message: [
    "Mobile Codex approval smoke.",
    "Create or overwrite .tmp/mobile-codex-approval-smoke.txt with exactly APPROVAL_SMOKE_OK.",
    "Use a shell command if needed.",
  ].join(" "),
  cwd: process.cwd(),
  approvalPolicy: "on-request",
  sandbox: "read-only",
});

let snapshot = started;
let approved = false;
const approvalDeadline = Date.now() + 60_000;
while (!approved && Date.now() < approvalDeadline) {
  await delay(1000);
  const response = await get<{ turn: LiveTurnSnapshot | null }>(`/api/live/turns/${encodeURIComponent(started.turnId)}`);
  if (!response.turn) throw new Error("turn not found");
  snapshot = response.turn;
  const pending = snapshot.approvals.find((approval) => approval.status === "pending");
  if (pending) {
    const approvalResponse = await post<{ turn: LiveTurnSnapshot | null }>(
      `/api/live/turns/${encodeURIComponent(started.turnId)}/approvals/${encodeURIComponent(pending.id)}/respond`,
      { decision: "accept" },
    );
    if (!approvalResponse.turn) throw new Error("approval response did not return a turn");
    snapshot = approvalResponse.turn;
    approved = true;
  }
  if (snapshot.status === "failed") throw new Error(`turn failed before approval: ${snapshot.error ?? ""}`);
}

if (!approved) {
  throw new Error(`Timed out waiting for an approval request; status=${snapshot.status} approvals=${snapshot.approvals.length}`);
}

const completionDeadline = Date.now() + 120_000;
while ((snapshot.status === "starting" || snapshot.status === "inProgress") && Date.now() < completionDeadline) {
  await delay(1000);
  const response = await get<{ turn: LiveTurnSnapshot | null }>(`/api/live/turns/${encodeURIComponent(started.turnId)}`);
  if (!response.turn) throw new Error("turn not found");
  snapshot = response.turn;
}

if (snapshot.status !== "completed") {
  throw new Error(`Expected completed after approval, got ${snapshot.status}: ${snapshot.error ?? ""}`);
}

console.log(
  JSON.stringify(
    {
      endpoint,
      threadId: snapshot.threadId,
      turnId: snapshot.turnId,
      status: snapshot.status,
      approvals: snapshot.approvals.map((approval) => ({
        kind: approval.kind,
        status: approval.status,
        title: approval.title,
      })),
      messageCount: snapshot.messageCount,
      eventCount: snapshot.eventCount,
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
