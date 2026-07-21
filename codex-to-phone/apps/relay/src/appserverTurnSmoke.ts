import { AppServerClient } from "./appServerClient.js";

const client = new AppServerClient({
  requestTimeoutMs: 120_000,
});

type ThreadStartResponse = {
  thread: {
    id: string;
    name: string | null;
    cwd: string;
    source: unknown;
  };
};

type TurnStartResponse = {
  turn: {
    id: string;
  };
};

try {
  await client.start();

  let assistantText = "";
  let completed = false;
  let failedRequest: unknown = null;

  client.on("notification", (event: { method: string; params?: any; id?: string | number }) => {
    if (event.method === "item/agentMessage/delta" && typeof event.params?.delta === "string") {
      assistantText += event.params.delta;
    }
    if (event.method === "turn/completed") {
      completed = true;
      const items = event.params?.turn?.items;
      if (Array.isArray(items)) {
        const message = items.find((item) => item?.type === "agentMessage" && typeof item.text === "string");
        if (message?.text) assistantText = message.text;
      }
    }
    if (event.id !== undefined) {
      failedRequest = event;
    }
  });

  const thread = await client.request<ThreadStartResponse>("thread/start", {
    cwd: process.cwd(),
    approvalPolicy: "never",
    sandbox: "read-only",
    sessionStartSource: "startup",
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  });

  const turn = await client.request<TurnStartResponse>("turn/start", {
    threadId: thread.thread.id,
    input: [
      {
        type: "text",
        text: "Mobile Codex relay live-turn smoke test. Please reply exactly: OK: mobile relay live turn. Do not run tools or modify files.",
        text_elements: [],
      },
    ],
    approvalPolicy: "never",
  });

  const deadline = Date.now() + 120_000;
  while (!completed && Date.now() < deadline && !failedRequest) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (failedRequest) {
    throw new Error(`Unexpected server request during smoke: ${JSON.stringify(failedRequest)}`);
  }
  if (!completed) {
    throw new Error("Timed out waiting for turn/completed");
  }

  console.log(
    JSON.stringify(
      {
        threadId: thread.thread.id,
        turnId: turn.turn.id,
        cwd: thread.thread.cwd,
        source: thread.thread.source,
        assistantText,
      },
      null,
      2,
    ),
  );
} finally {
  await client.stop();
}
