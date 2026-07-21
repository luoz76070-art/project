import { setTimeout as delay } from "node:timers/promises";
import { DesktopIpcClient, type DesktopIpcEnvelope } from "./desktopIpcClient.js";

const probeClientType = "mobile-codex-relay-probe";
const client = new DesktopIpcClient({ clientType: probeClientType, requestTimeoutMs: 6_000 });
const messages: DesktopIpcEnvelope[] = [];

client.onAnyMessage((message) => {
  messages.push(message);
  if (messages.length > 30) messages.shift();
});

try {
  const status = await client.connect();
  console.log(JSON.stringify({ step: "connect", status }, null, 2));

  await delay(1_000);
  console.log(
    JSON.stringify(
      {
        step: "passive-listen",
        messageCount: messages.length,
        messages: summarizeMessages(messages),
      },
      null,
      2,
    ),
  );

  const threadRoleResponse = await client
    .sendRequest("thread-role", { conversationId: "00000000-0000-0000-0000-000000000000" }, { version: 1 })
    .catch((error) => ({ resultType: "error", error: error instanceof Error ? error.message : String(error) }));
  console.log(JSON.stringify({ step: "thread-role-discovery", response: threadRoleResponse }, null, 2));
} finally {
  await client.disconnect();
}

function summarizeMessages(items: DesktopIpcEnvelope[]): Array<Record<string, unknown>> {
  return items.map((item) => {
    if (item.type === "broadcast") {
      return {
        type: item.type,
        method: item.method,
        sourceClientId: item.sourceClientId,
        params: item.params,
      };
    }
    if (item.type === "client-discovery-request") {
      return {
        type: item.type,
        method: item.request.method,
        sourceClientId: item.request.sourceClientId,
        targetClientId: item.request.targetClientId,
      };
    }
    if (item.type === "request") {
      return {
        type: item.type,
        method: item.method,
        sourceClientId: item.sourceClientId,
        targetClientId: item.targetClientId,
      };
    }
    if (item.type === "response") {
      return {
        type: item.type,
        resultType: item.resultType,
        method: item.method,
        handledByClientId: item.handledByClientId,
        error: item.error,
      };
    }
    return { type: item.type };
  });
}
