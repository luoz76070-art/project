import { CodexStore } from "./codexStore.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const store = new CodexStore(config.codexHome);

const threads = await store.listThreads(5);
console.log(JSON.stringify({ codexHome: config.codexHome, threadCount: threads.length, threads }, null, 2));

if (threads.length === 0) {
  throw new Error("No Codex Desktop threads found.");
}

const first = await store.readThread(threads[0].id);
console.log(JSON.stringify({ firstThread: first.thread, messageCount: first.messages.length }, null, 2));

if (!first.thread) {
  throw new Error("Unable to read first thread.");
}
