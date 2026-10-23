import { CodexStore } from "../store/codexStore.js";
import { loadConfig } from "../config.js";
import { DesktopControl } from "../desktop/desktopControl.js";
import { randomUUID } from "node:crypto";
import type { DesktopControlCapability } from "../desktop/desktopNativeControl.js";

const config = loadConfig();
const store = new CodexStore(config.codexHome);
const control = new DesktopControl(store, { codexHome: config.codexHome, transport: config.desktopTransport });

const status = await control.status();
const result: Record<string, unknown> = {
  ok: status.ok,
  mode: status.mode,
  ipc: status.ipc,
  activeThread: status.activeThread,
  capabilities: status.capabilities,
  error: status.error ?? null,
  mutation: "skipped",
};

if (!status.ok) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}

try {
  if (process.env.MOBILE_CODEX_DESKTOP_CONTROL_MUTATE === "1") {
    const message = process.env.MOBILE_CODEX_DESKTOP_CONTROL_MESSAGE;
    const threadId = process.env.MOBILE_CODEX_DESKTOP_CONTROL_THREAD_ID ?? status.activeThread?.id;
    if (!message || !threadId) {
      throw new Error("Set MOBILE_CODEX_DESKTOP_CONTROL_MESSAGE and ensure a desktop thread exists before mutating.");
    }
    const legacy = status.mode === "macos-ui-injector-control";
    const release = legacy ? () => {} : control.followThread(threadId);
    try {
      const capability = legacy ? undefined : await new Promise<DesktopControlCapability>((resolve, reject) => {
        const timer = setTimeout(() => { unsubscribe(); reject(new Error("Native Desktop snapshot unavailable; no message was submitted.")); }, 5_000);
        const check = () => {
          const value = control.getStreamSnapshot(threadId)?.control;
          if (value?.token) { clearTimeout(timer); unsubscribe(); resolve(value); }
        };
        const unsubscribe = control.onStreamSnapshot(check);
        check();
      });
      result.mutation = await control.sendMessage({
        threadId, message, cwd: status.activeThread?.cwd ?? null, mode: "auto",
        clientMessageId: randomUUID(), controlToken: capability?.token ?? undefined, expectedTurnId: capability?.activeTurnId ?? null,
      });
    } finally { release(); }
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await control.stop();
  store.close();
}
