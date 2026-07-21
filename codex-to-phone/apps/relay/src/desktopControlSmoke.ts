import { CodexStore } from "./codexStore.js";
import { loadConfig } from "./config.js";
import { DesktopControl } from "./desktopControl.js";

const config = loadConfig();
const store = new CodexStore(config.codexHome);
const control = new DesktopControl(store);

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
    result.mutation = await control.sendMessage({
      threadId,
      message,
      cwd: status.activeThread?.cwd ?? null,
      mode: "auto",
    });
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await control.stop();
}
