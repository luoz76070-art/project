#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { URL } from "node:url";

const DEFAULT_PORT = 8765;
const DEFAULT_HOST = "127.0.0.1";
const MAX_BUFFERED_EVENTS = 1500;
const DEFAULT_ROLLOUT_BACKFILL_LINES = 120;
const TURN_START_TIMEOUT_MS = 90_000;
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const UI_HELPER_APP = path.resolve(SCRIPT_DIR, "..", "Codex Live Session Input.app");
const UI_HELPER_EXEC = path.join(UI_HELPER_APP, "Contents", "MacOS", "CodexLiveSessionInput");
const UI_HELPER_INPUT_FILE = "/tmp/codex-live-session-input.txt";
const DESKTOP_IPC_INITIALIZING_CLIENT_ID = "initializing-client";
const DESKTOP_IPC_FRAME_LIMIT_BYTES = 256 * 1024 * 1024;
const DESKTOP_IPC_CONNECT_TIMEOUT_MS = 5_000;
const DESKTOP_IPC_REQUEST_TIMEOUT_MS = 15_000;
const DESKTOP_IPC_METHOD_VERSIONS = new Map([
  ["thread-follower-start-turn", 1],
  ["thread-follower-steer-turn", 1],
]);

function parseArgs(argv) {
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    mode: "spawn",
    activePolicy: "queue",
    autoBind: false,
    initialize: true,
    threadId: "",
    token: "",
    publicUrl: "",
    sock: "",
    desktopIpcSock: "",
    rolloutFile: "",
    injector: "",
    backfillLines: DEFAULT_ROLLOUT_BACKFILL_LINES,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) {
        throw new Error(`Missing value after ${arg}`);
      }
      return argv[i];
    };
    if (arg === "--host") options.host = next();
    else if (arg === "--port") options.port = Number(next());
    else if (arg === "--mode") options.mode = next();
    else if (arg === "--thread-id") options.threadId = next();
    else if (arg === "--token") options.token = next();
    else if (arg === "--public-url") options.publicUrl = next();
    else if (arg === "--sock") options.sock = next();
    else if (arg === "--desktop-ipc-sock") options.desktopIpcSock = next();
    else if (arg === "--rollout-file") options.rolloutFile = next();
    else if (arg === "--injector") options.injector = next();
    else if (arg === "--backfill-lines") options.backfillLines = Number(next());
    else if (arg === "--active-policy") options.activePolicy = next();
    else if (arg === "--auto-bind") options.autoBind = true;
    else if (arg === "--skip-initialize") options.initialize = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  if (!["proxy", "spawn"].includes(options.mode)) {
    throw new Error("--mode must be proxy or spawn");
  }
  if (!options.injector) {
    options.injector = options.rolloutFile ? "desktop-ipc" : "app-server";
  }
  if (!["app-server", "debug", "desktop-ipc", "ui", "none"].includes(options.injector)) {
    throw new Error("--injector must be app-server, debug, desktop-ipc, ui, or none");
  }
  if (!["queue", "steer", "reject"].includes(options.activePolicy)) {
    throw new Error("--active-policy must be queue, steer, or reject");
  }
  if (!Number.isInteger(options.backfillLines) || options.backfillLines < 0) {
    throw new Error("--backfill-lines must be a non-negative integer");
  }
  options.token ||= randomBytes(24).toString("base64url");
  return options;
}

function printHelp() {
  console.log(`Codex Live Session Bridge

Usage:
  node plugins/codex-live-session/scripts/bridge.mjs --thread-id <thread-id>
  node plugins/codex-live-session/scripts/bridge.mjs --auto-bind

Options:
  --thread-id <id>          Bind to a specific Codex thread id.
  --auto-bind              Bind only when exactly one loaded thread is visible.
  --host <host>            HTTP bind host. Default: ${DEFAULT_HOST}
  --port <port>            HTTP bind port. Default: ${DEFAULT_PORT}
  --public-url <url>       URL printed for phone pairing.
  --mode <proxy|spawn>     spawn starts a bridge-owned app-server. Default: spawn
  --sock <path>            Optional app-server control socket for proxy mode.
  --desktop-ipc-sock <path> Optional Codex Desktop IPC socket for desktop-ipc mode.
  --rollout-file <path>    Tail a Codex Desktop rollout JSONL file for current-session testing.
  --injector <mode>        app-server, debug, desktop-ipc, ui, or none. Defaults to desktop-ipc with --rollout-file.
  --backfill-lines <n>     Recent rollout lines to show on connect. Default: ${DEFAULT_ROLLOUT_BACKFILL_LINES}
  --active-policy <mode>   queue, steer, or reject while a turn is active. Default: queue
  --token <token>          Override generated pairing token.
  --skip-initialize        Do not send app-server initialize/initialized.
`);
}

class JsonRpcClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.notificationHandler = null;
    this.requestHandler = null;
    this.closed = false;
    this.stderr = "";

    this.rl = readline.createInterface({ input: child.stdout });
    this.rl.on("line", (line) => this.#handleLine(line));
    child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
      if (this.stderr.length > 8192) {
        this.stderr = this.stderr.slice(-8192);
      }
    });
    child.on("exit", (code, signal) => {
      this.closed = true;
      const message = `app-server transport exited code=${code ?? "null"} signal=${signal ?? "null"}`;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`${message}\n${this.stderr}`.trim()));
      }
      this.pending.clear();
    });
  }

  onNotification(handler) {
    this.notificationHandler = handler;
  }

  onRequest(handler) {
    this.requestHandler = handler;
  }

  request(method, params = {}, timeoutMs = 30_000) {
    if (this.closed) {
      return Promise.reject(new Error("app-server transport is closed"));
    }
    const id = this.nextId;
    this.nextId += 1;
    this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  notify(method, params = {}) {
    if (!this.closed) {
      this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
    }
  }

  dispose() {
    this.closed = true;
    this.rl.close();
    this.child.kill("SIGTERM");
  }

  #respond(id, result, error) {
    if (this.closed) return;
    const payload = error ? { id, error: { message: error.message } } : { id, result };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async #handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (typeof message.id === "number" && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "Unknown JSON-RPC error"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.id === "number" && typeof message.method === "string") {
      try {
        const result = this.requestHandler
          ? await this.requestHandler(message.method, message.params)
          : {};
        this.#respond(message.id, result ?? {}, null);
      } catch (error) {
        this.#respond(
          message.id,
          null,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      return;
    }

    if (typeof message.method === "string") {
      this.notificationHandler?.(message.method, message.params ?? {});
    }
  }
}

function defaultDesktopIpcSocketPath() {
  if (process.platform === "win32") {
    return path.join("\\\\.\\pipe", "codex-ipc");
  }
  const userId = process.getuid?.();
  return path.join(os.tmpdir(), "codex-ipc", userId ? `ipc-${userId}.sock` : "ipc.sock");
}

function desktopIpcMethodVersion(method) {
  return DESKTOP_IPC_METHOD_VERSIONS.get(method) ?? 0;
}

function desktopIpcFrame(message) {
  const json = JSON.stringify(message);
  const length = Buffer.byteLength(json, "utf8");
  const frame = Buffer.alloc(4 + length);
  frame.writeUInt32LE(length, 0);
  frame.write(json, 4, "utf8");
  return frame;
}

class DesktopIpcClient {
  constructor(sock = "") {
    this.sock = sock || defaultDesktopIpcSocketPath();
    this.clientId = DESKTOP_IPC_INITIALIZING_CLIENT_ID;
    this.socket = null;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.expectedFrameBytes = null;
    this.closed = false;
  }

  async connect() {
    if (this.socket?.writable) return;
    await new Promise((resolve, reject) => {
      const socket = net.connect(this.sock);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Timed out connecting to Codex Desktop IPC socket: ${this.sock}`));
      }, DESKTOP_IPC_CONNECT_TIMEOUT_MS);

      socket.on("connect", () => {
        clearTimeout(timer);
        this.socket = socket;
        socket.on("data", (chunk) => this.#handleData(chunk));
        socket.on("close", () => this.#handleClose());
        socket.on("error", (error) => this.#handleClose(error));
        resolve();
      });
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async initialize() {
    const response = await this.request("initialize", { clientType: "codex-live-session" });
    if (response.resultType !== "success" || response.method !== "initialize") {
      throw new Error(`Codex Desktop IPC initialize failed: ${JSON.stringify(response)}`);
    }
    this.clientId = response.result?.clientId ?? this.clientId;
    return response;
  }

  request(method, params = {}, timeoutMs = DESKTOP_IPC_REQUEST_TIMEOUT_MS) {
    const socket = this.socket;
    if (!socket?.writable) {
      return Promise.reject(new Error("Codex Desktop IPC socket is not connected"));
    }
    if (this.clientId === DESKTOP_IPC_INITIALIZING_CLIENT_ID && method !== "initialize") {
      return Promise.reject(new Error("Codex Desktop IPC client is not initialized"));
    }

    const requestId = randomUUID();
    const payload = {
      type: "request",
      requestId,
      sourceClientId: this.clientId,
      version: desktopIpcMethodVersion(method),
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Timed out waiting for Codex Desktop IPC ${method}`));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (message) => {
          if (message.resultType === "error") {
            reject(new Error(message.error ?? `Codex Desktop IPC ${method} failed`));
          } else {
            resolve(message);
          }
        },
        reject,
        timer,
      });
      try {
        socket.write(desktopIpcFrame(payload));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose() {
    this.closed = true;
    this.socket?.destroy();
    this.#rejectPending(new Error("Codex Desktop IPC client disposed"));
  }

  #send(message) {
    if (this.socket?.writable) {
      this.socket.write(desktopIpcFrame(message));
    }
  }

  #handleData(chunk) {
    if (this.closed) return;
    if (this.buffer.length + chunk.length > DESKTOP_IPC_FRAME_LIMIT_BYTES * 2) {
      this.#handleClose(new Error("Codex Desktop IPC buffer exceeded limit"));
      return;
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      if (this.expectedFrameBytes == null) {
        if (this.buffer.length < 4) return;
        this.expectedFrameBytes = this.buffer.readUInt32LE(0);
        this.buffer = this.buffer.subarray(4);
        if (this.expectedFrameBytes > DESKTOP_IPC_FRAME_LIMIT_BYTES) {
          this.#handleClose(new Error("Codex Desktop IPC frame exceeded limit"));
          return;
        }
      }
      if (this.buffer.length < this.expectedFrameBytes) return;
      const raw = this.buffer.subarray(0, this.expectedFrameBytes).toString("utf8");
      this.buffer = this.buffer.subarray(this.expectedFrameBytes);
      this.expectedFrameBytes = null;
      let message;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        this.#handleClose(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.#handleMessage(message);
    }
  }

  #handleMessage(message) {
    if (message.type === "response") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      if (message.resultType === "success" && message.method === "initialize") {
        this.clientId = message.result?.clientId ?? this.clientId;
      }
      pending.resolve(message);
      return;
    }

    if (message.type === "client-discovery-request") {
      this.#send({
        type: "client-discovery-response",
        requestId: message.requestId,
        response: { canHandle: false },
      });
      return;
    }

    if (message.type === "request") {
      this.#send({
        type: "response",
        requestId: message.requestId,
        resultType: "error",
        error: "no-handler-for-request",
      });
    }
  }

  #handleClose(error) {
    if (this.closed && !error) return;
    this.closed = true;
    this.socket?.destroy();
    this.#rejectPending(error ?? new Error("Codex Desktop IPC connection closed"));
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function spawnTransport(mode, sock) {
  const args = mode === "proxy" ? ["app-server", "proxy"] : ["app-server"];
  if (mode === "proxy" && sock) {
    args.push("--sock", sock);
  }
  return spawn("codex", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
}

async function ensureThreadLoaded(client, threadId) {
  const loaded = await client.request("thread/loaded/list", { limit: 100 });
  const ids = Array.isArray(loaded?.data) ? loaded.data : [];
  if (ids.includes(threadId)) {
    return { alreadyLoaded: true };
  }
  const resumed = await client.request("thread/resume", { threadId }, 60_000);
  return { alreadyLoaded: false, resumed };
}

function appServerInitializeParams() {
  return {
    clientInfo: {
      name: "codex-live-session",
      title: "Codex Live Session",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  };
}

function textInput(text) {
  return { type: "text", text, text_elements: [] };
}

function sendViaDebugInjector(text) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["debug", "app-server", "send-message-v2", text], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out waiting for debug injector"));
    }, 15_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout: stdout.trim() });
      } else {
        reject(new Error((stderr || stdout || `debug injector exited ${code}`).trim()));
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sendViaUiInjector(text) {
  if (fs.existsSync(UI_HELPER_APP)) {
    fs.writeFileSync(UI_HELPER_INPUT_FILE, text, { mode: 0o600 });
    const command = fs.existsSync(UI_HELPER_EXEC) ? UI_HELPER_EXEC : "open";
    const args = fs.existsSync(UI_HELPER_EXEC) ? [] : ["-W", UI_HELPER_APP];
    const method = fs.existsSync(UI_HELPER_EXEC) ? "ui-helper-native" : "ui-helper";
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Timed out waiting for UI helper app"));
      }, 10_000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout: stdout.trim(), method, helperApp: UI_HELPER_APP });
        } else {
          reject(new Error((stderr || stdout || `UI helper app exited ${code}`).trim()));
        }
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  const script = `
on run argv
  set messageText to item 1 of argv
  set previousClipboard to the clipboard
  try
    set the clipboard to messageText
    tell application "Codex" to activate
    delay 0.35
    tell application "System Events"
      keystroke "v" using command down
      delay 0.05
      key code 36
    end tell
    delay 0.1
    set the clipboard to previousClipboard
  on error errMsg number errNum
    try
      set the clipboard to previousClipboard
    end try
    error errMsg number errNum
  end try
end run
`;
  return new Promise((resolve, reject) => {
    const child = spawn("osascript", ["-e", script, text], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out waiting for UI injector"));
    }, 10_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout: stdout.trim(), method: "ui" });
      } else {
        reject(new Error((stderr || stdout || `UI injector exited ${code}`).trim()));
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function sendViaDesktopIpcInjector(text, threadId, desktopIpcSock) {
  const ipc = new DesktopIpcClient(desktopIpcSock);
  await ipc.connect();
  try {
    await ipc.initialize();
    return await ipc.request(
      "thread-follower-start-turn",
      {
        conversationId: threadId,
        turnStartParams: { input: [textInput(text)] },
      },
      TURN_START_TIMEOUT_MS,
    );
  } finally {
    ipc.dispose();
  }
}

function explainInjectorError(error, injector) {
  const raw = error instanceof Error ? error.message : String(error);
  if (
    injector === "ui" &&
    (/不允许发送按键/u.test(raw) ||
      /not allowed to send keystrokes/i.test(raw) ||
      /not authorized/i.test(raw) ||
      /accessibility permission/i.test(raw) ||
      /not granted/i.test(raw) ||
      /assistive access/i.test(raw))
  ) {
    return [
      "macOS 阻止了 UI 注入器发送按键。",
      "请打开 系统设置 > 隐私与安全性 > 辅助功能，允许 Codex Live Session Input、Codex、Terminal 或 osascript 控制电脑，然后重新发送手机消息。",
      `原始错误：${raw}`,
    ].join("\n");
  }
  if (injector === "desktop-ipc") {
    if (/no-client-found/i.test(raw)) {
      return [
        "Codex Desktop 没有找到可接收这个会话的当前窗口。",
        "这表示当前打开的 Codex Desktop 窗口没有把该 thread 暴露为 owner。",
        "请确认 PC 端正打开并停留在同一个 Codex 会话窗口；必要时从历史记录重新打开这个会话后再发送。",
        `原始错误：${raw}`,
      ].join("\n");
    }
    if (/request-timeout|Timed out/i.test(raw)) {
      return [
        "Codex Desktop IPC 已连接，但当前窗口没有及时响应注入请求。",
        "请确认当前会话没有卡在弹窗、权限确认或正在运行的回合里；必要时刷新当前 Codex 窗口后重试。",
        `原始错误：${raw}`,
      ].join("\n");
    }
    if (/ENOENT|not-connected|connection/i.test(raw)) {
      return [
        "没有连上 Codex Desktop 的本地 IPC socket。",
        "请确认 Codex Desktop 正在运行，再重新启动 Codex Live Session。",
        `原始错误：${raw}`,
      ].join("\n");
    }
  }
  return raw;
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeJsonText(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "");
}

function sanitizeJsonPayload(value) {
  if (typeof value === "string") return sanitizeJsonText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonPayload(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sanitizeJsonPayload(item)]),
  );
}

function normalizeEvent(method, params) {
  if (method === "turn/started") {
    return {
      type: "turn.started",
      threadId: params.threadId,
      turnId: params.turn?.id ?? "",
      status: params.turn?.status ?? "running",
      at: nowIso(),
    };
  }
  if (method === "turn/completed") {
    return {
      type: "turn.completed",
      threadId: params.threadId,
      turnId: params.turn?.id ?? "",
      status: params.turn?.status ?? "completed",
      at: nowIso(),
    };
  }
  if (method === "item/started" || method === "item/completed") {
    return {
      type: method === "item/started" ? "item.started" : "item.completed",
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.item?.id ?? "",
      itemType: params.item?.type ?? "unknown",
      item: summarizeItem(params.item),
      at: nowIso(),
    };
  }
  if (method === "item/agentMessage/delta") {
    return {
      type: "assistant.delta",
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      text: params.delta ?? "",
      at: nowIso(),
    };
  }
  if (method === "item/plan/delta") {
    return {
      type: "plan.delta",
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      text: params.delta ?? "",
      at: nowIso(),
    };
  }
  if (
    method === "item/commandExecution/outputDelta" ||
    method === "command/exec/outputDelta" ||
    method === "process/outputDelta" ||
    method === "item/fileChange/outputDelta"
  ) {
    return {
      type: "tool.delta",
      source: method,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      text: params.delta ?? "",
      at: nowIso(),
    };
  }
  if (method === "thread/status/changed") {
    return {
      type: "thread.status",
      threadId: params.threadId,
      status: params.status,
      at: nowIso(),
    };
  }
  if (method === "warning" || method === "error") {
    return {
      type: method,
      message: params.message ?? JSON.stringify(params),
      at: nowIso(),
    };
  }
  return null;
}

function normalizeRolloutRecord(record) {
  if (!record || typeof record !== "object") return null;
  const payload = record.payload;
  if (!payload || typeof payload !== "object") return null;
  const at = typeof record.timestamp === "string" ? record.timestamp : nowIso();

  if (record.type === "session_meta") {
    return {
      type: "session.meta",
      threadId: payload.id,
      cwd: payload.cwd,
      source: payload.originator ?? payload.source,
      at,
    };
  }
  if (record.type === "response_item") {
    if (payload.type === "function_call" || payload.type === "custom_tool_call") {
      return {
        type: "tool.started",
        itemId: payload.call_id ?? payload.id ?? "",
        label: payload.name ?? payload.tool_name ?? payload.type,
        text: payload.arguments ?? payload.input ?? "",
        source: record.type,
        at,
      };
    }
    if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      return {
        type: "tool.completed",
        itemId: payload.call_id ?? payload.id ?? "",
        label: payload.name ?? payload.tool_name ?? payload.type,
        text: payload.output ?? "",
        source: record.type,
        at,
      };
    }
    if (payload.type === "web_search_call") {
      return {
        type: "tool.started",
        itemId: payload.call_id ?? payload.id ?? "",
        label: "web_search",
        text: payload.query ?? "",
        source: record.type,
        at,
      };
    }
    return null;
  }
  if (record.type !== "event_msg") return null;

  if (payload.type === "task_started") {
    return {
      type: "turn.started",
      threadId: "",
      turnId: payload.turn_id ?? "",
      status: "running",
      at,
    };
  }
  if (payload.type === "task_complete") {
    return {
      type: "turn.completed",
      threadId: "",
      turnId: payload.turn_id ?? "",
      status: "completed",
      text: payload.last_agent_message ?? "",
      at,
    };
  }
  if (payload.type === "user_message") {
    return {
      type: "user.message",
      text: payload.message ?? "",
      at,
    };
  }
  if (payload.type === "agent_message") {
    return {
      type: "assistant.message",
      text: payload.message ?? "",
      phase: payload.phase ?? null,
      at,
    };
  }
  if (payload.type === "exec_command_begin") {
    return {
      type: "tool.started",
      label: Array.isArray(payload.command) ? payload.command.join(" ") : "command",
      at,
    };
  }
  if (payload.type === "exec_command_end") {
    return {
      type: "tool.completed",
      label: Array.isArray(payload.command) ? payload.command.join(" ") : "command",
      status: payload.status ?? "completed",
      text: payload.aggregated_output ?? "",
      at,
    };
  }
  if (payload.type === "patch_apply_begin") {
    return {
      type: "tool.started",
      label: "apply_patch",
      at,
    };
  }
  if (payload.type === "patch_apply_end") {
    return {
      type: "tool.completed",
      label: "apply_patch",
      status: payload.success === false ? "failed" : "completed",
      text: payload.stderr ?? payload.stdout ?? "",
      at,
    };
  }
  if (payload.type === "web_search_end") {
    return {
      type: "tool.completed",
      label: "web_search",
      text: payload.query ?? "",
      at,
    };
  }
  if (payload.type === "context_compacted") {
    return {
      type: "context.compacted",
      message: "Context compacted",
      at,
    };
  }
  return null;
}

function createRolloutTailer(file, onEvent, onActiveTurnChange) {
  let offset = fs.existsSync(file) ? fs.statSync(file).size : 0;
  let carry = "";

  function readNewContent() {
    if (!fs.existsSync(file)) return;
    const stat = fs.statSync(file);
    if (stat.size < offset) {
      offset = 0;
      carry = "";
    }
    if (stat.size === offset) return;
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(stat.size - offset);
      fs.readSync(fd, buffer, 0, buffer.length, offset);
      offset = stat.size;
      carry += buffer.toString("utf8");
      const lines = carry.split(/\n/u);
      carry = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = normalizeRolloutRecord(JSON.parse(line));
          if (!event) continue;
          if (event.type === "turn.started") {
            onActiveTurnChange(event.turnId || "");
          }
          if (event.type === "turn.completed") {
            onActiveTurnChange("");
          }
          onEvent(event);
        } catch {
          // Ignore partial or malformed rollout lines.
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  const timer = setInterval(readNewContent, 500);
  return () => clearInterval(timer);
}

function parseRolloutRecords(file) {
  if (!file || !fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const records = [];
  for (const line of raw.split(/\n/u)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Ignore malformed historical lines.
    }
  }
  return records;
}

function rolloutBoundary(record) {
  const payload = record?.payload;
  if (!payload || typeof payload !== "object") return null;
  if (record.type === "event_msg" && payload.type === "task_started") {
    return { type: "start", turnId: payload.turn_id ?? "" };
  }
  if (record.type === "event_msg" && payload.type === "task_complete") {
    return { type: "complete", turnId: payload.turn_id ?? "" };
  }
  return null;
}

function selectBackfillRecords(records, fallbackLineLimit) {
  const turns = [];
  let current = null;
  for (let index = 0; index < records.length; index += 1) {
    const boundary = rolloutBoundary(records[index]);
    if (!boundary) continue;
    if (boundary.type === "start") {
      current = { start: index, end: null, turnId: boundary.turnId };
      turns.push(current);
    } else if (current) {
      current.end = index;
      current = null;
    }
  }

  const activeTurn = turns.findLast((turn) => turn.end === null);
  const completedTurns = turns.filter((turn) => turn.end !== null);
  const previousCompletedTurn = completedTurns.at(-1);
  const ranges = [];
  if (previousCompletedTurn) ranges.push(previousCompletedTurn);
  if (activeTurn) ranges.push({ ...activeTurn, end: records.length - 1 });

  if (ranges.length === 0) {
    return records.slice(-fallbackLineLimit);
  }

  const selected = new Set();
  for (const range of ranges) {
    for (let index = range.start; index <= range.end; index += 1) {
      selected.add(index);
    }
  }
  return [...selected].sort((a, b) => a - b).map((index) => records[index]);
}

function seedRolloutBackfill(file, lineLimit, onEvent, onActiveTurnChange) {
  const records = parseRolloutRecords(file);
  const selectedRecords = selectBackfillRecords(records, lineLimit);
  for (const record of selectedRecords) {
    try {
      const event = normalizeRolloutRecord(record);
      if (!event) continue;
      if (event.type === "turn.started") onActiveTurnChange(event.turnId || "");
      if (event.type === "turn.completed") onActiveTurnChange("");
      onEvent({ ...event, backfilled: true });
    } catch {
      // Ignore malformed historical records.
    }
  }
}

function detectActiveTurnFromRollout(file) {
  let activeTurnId = "";
  for (const record of parseRolloutRecords(file)) {
    try {
      const event = normalizeRolloutRecord(record);
      if (!event) continue;
      if (event.type === "turn.started") activeTurnId = event.turnId || "";
      if (event.type === "turn.completed") activeTurnId = "";
    } catch {
      // Ignore malformed historical records.
    }
  }
  return activeTurnId;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function codexSessionsDir() {
  return path.join(os.homedir(), ".codex", "sessions");
}

function collectRolloutFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(full);
      }
    }
  }
  return files;
}

function recordTimestampMs(record) {
  if (typeof record?.timestamp !== "string") return 0;
  const ms = Date.parse(record.timestamp);
  return Number.isFinite(ms) ? ms : 0;
}

function rolloutHasUserMessage(file, text, sinceMs) {
  for (const record of parseRolloutRecords(file)) {
    if (recordTimestampMs(record) < sinceMs - 5_000) continue;
    const payload = record.payload;
    if (record.type === "event_msg" && payload?.type === "user_message" && payload.message === text) {
      return true;
    }
  }
  return false;
}

function rolloutThreadId(file) {
  for (const record of parseRolloutRecords(file)) {
    if (record.type === "session_meta" && typeof record.payload?.id === "string") {
      return record.payload.id;
    }
  }
  return "";
}

function findRolloutWithUserMessage(text, sinceMs, excludeFile) {
  const exclude = excludeFile ? path.resolve(excludeFile) : "";
  const files = collectRolloutFiles(codexSessionsDir());
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const file of files) {
    if (exclude && path.resolve(file) === exclude) continue;
    if (fs.statSync(file).mtimeMs < sinceMs - 5_000) continue;
    if (rolloutHasUserMessage(file, text, sinceMs)) {
      return { file, threadId: rolloutThreadId(file) };
    }
  }
  return null;
}

async function verifyBoundRolloutInput({ rolloutFile, threadId, text, startedAtMs }) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (rolloutHasUserMessage(rolloutFile, text, startedAtMs)) {
      return { ok: true, threadId };
    }
    await delay(250);
  }

  const sideSession = findRolloutWithUserMessage(text, startedAtMs, rolloutFile);
  if (sideSession) {
    return {
      ok: false,
      reason: "debug injector created a separate session instead of the bound Desktop session",
      sideSession,
    };
  }
  return {
    ok: false,
    reason: "bound Desktop session did not record the phone message",
  };
}

function summarizeItem(item) {
  if (!item || typeof item !== "object") return null;
  if (item.type === "userMessage") {
    return {
      text: Array.isArray(item.content)
        ? item.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
        : "",
    };
  }
  if (item.type === "commandExecution") {
    return { command: item.command, cwd: item.cwd, status: item.status };
  }
  if (item.type === "fileChange") {
    return { status: item.status, changes: Array.isArray(item.changes) ? item.changes.length : 0 };
  }
  if (item.type === "mcpToolCall") {
    return { server: item.server, tool: item.tool, status: item.status };
  }
  if (item.type === "webSearch") {
    return { query: item.query };
  }
  if (item.type === "agentMessage") {
    return { text: item.text ?? "" };
  }
  return { type: item.type };
}

function renderPhonePage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
  <title>Codex Live Session</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fb; color: #172033; }
    * { box-sizing: border-box; }
    html { height: 100%; }
    body { margin: 0; min-height: 100%; height: var(--app-height, 100dvh); overflow: hidden; display: flex; flex-direction: column; background: #f7f8fb; color: #172033; }
    header { flex: 0 0 auto; z-index: 2; padding: 14px 16px 12px; background: rgba(255,255,255,.94); border-bottom: 1px solid #dde3ee; backdrop-filter: blur(16px); }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    h1 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: 0; }
    #status { display: inline-flex; align-items: center; gap: 7px; margin-top: 7px; font-size: 12px; color: #526071; }
    #status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #14b87a; box-shadow: 0 0 0 3px rgba(20,184,122,.13); }
    main { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 14px 12px 12px; }
    .event { border: 1px solid #dde3ee; background: #fff; border-radius: 8px; padding: 11px 12px; margin-bottom: 10px; overflow-wrap: anywhere; box-shadow: 0 1px 2px rgba(20,31,51,.04); }
    .event .meta { color: #68778b; font-size: 11px; line-height: 1.35; margin-bottom: 7px; display: flex; justify-content: space-between; gap: 10px; }
    .event .body { white-space: pre-wrap; line-height: 1.52; font-size: 14px; }
    .assistant { border-left: 3px solid #2f6fed; }
    .user { border-left: 3px solid #13996b; }
    .tool { border-left: 3px solid #8b5cf6; background: #fbfaff; }
    .system { border-left: 3px solid #64748b; background: #fbfcfe; }
    .error { border-left: 3px solid #dc2626; background: #fff8f8; }
    form { flex: 0 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) 72px; align-items: end; gap: 8px; width: 100%; padding: 10px; padding-bottom: max(10px, env(safe-area-inset-bottom)); background: rgba(255,255,255,.96); border-top: 1px solid #dde3ee; backdrop-filter: blur(16px); }
    textarea { display: block; width: 100%; min-width: 0; height: 48px; min-height: 48px; max-height: 120px; overflow-y: auto; resize: none; appearance: none; -webkit-appearance: none; border-radius: 8px; border: 1px solid #c9d3e2; background: #fff; color: #172033; padding: 11px 12px; font-size: 16px; line-height: 1.35; }
    textarea:focus { outline: 2px solid rgba(37,99,235,.22); border-color: #2563eb; }
    button { width: 72px; height: 48px; min-width: 72px; appearance: none; -webkit-appearance: none; border: 0; border-radius: 8px; background: #2563eb; color: white; font-weight: 700; font-size: 15px; }
    #disconnect { flex: 0 0 auto; width: auto; min-width: 64px; height: 32px; padding: 0 10px; border: 1px solid #c9d3e2; background: #f3f6fb; color: #526071; font-size: 13px; }
    button:disabled { opacity: .45; }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <h1>Codex To Phone</h1>
      <button id="disconnect" type="button">断开</button>
    </div>
    <div id="status">正在连接</div>
  </header>
  <main id="events"></main>
  <form id="form">
    <textarea id="text" rows="1" enterkeyhint="send" autocomplete="off" autocapitalize="sentences" placeholder="输入消息"></textarea>
    <button id="send" type="submit">发送</button>
  </form>
  <script>
    const params = new URLSearchParams(location.search);
    const token = params.get("token") || "";
    const eventsEl = document.getElementById("events");
    const statusEl = document.getElementById("status");
    const textEl = document.getElementById("text");
    const sendEl = document.getElementById("send");
    const disconnectEl = document.getElementById("disconnect");
    let lastSeq = 0;
    let disconnected = false;
    let sessionEndedShown = false;
    let pollTimer = null;
    let source = null;
    const seenSeq = new Set();
    const shownMessageKeys = new Set();
    const streamTextById = new Map();
    const streamNodeById = new Map();

    function syncAppHeight() {
      const viewport = window.visualViewport;
      const height = Math.max(320, Math.floor(viewport?.height || window.innerHeight || 0));
      document.documentElement.style.setProperty("--app-height", height + "px");
    }

    syncAppHeight();
    window.addEventListener("resize", syncAppHeight);
    window.addEventListener("orientationchange", syncAppHeight);
    window.visualViewport?.addEventListener("resize", syncAppHeight);
    window.visualViewport?.addEventListener("scroll", syncAppHeight);
    textEl.addEventListener("focus", syncAppHeight);

    function timeText(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function clip(text, max = 110) {
      const normalized = String(text || "").replace(/\\s+/g, " ").trim();
      return normalized.length > max ? normalized.slice(0, max - 1).trimEnd() + "..." : normalized;
    }

    function toolName(label) {
      const raw = String(label || "tool").trim();
      if (raw === "apply_patch") return "apply_patch";
      if (raw === "web_search") return "web_search";
      if (raw.startsWith("{") || raw.startsWith("[")) return "tool";
      if (/\\brtk\\b|\\bnode\\b|\\bgit\\b|\\bcurl\\b|\\brg\\b|\\bsed\\b|\\btail\\b/.test(raw)) return "exec_command";
      return clip(raw, 72);
    }

    function markDisconnected(status = "已断开") {
      disconnected = true;
      disconnectEl.disabled = true;
      sendEl.disabled = true;
      textEl.disabled = true;
      if (source) source.close();
      if (pollTimer) clearInterval(pollTimer);
      statusEl.textContent = status;
    }

    function displayEvent(event) {
      if (!event || !event.type) return null;
      if (event.type === "session.started") {
        return { kind: "system", title: "会话已连接", body: "已绑定当前 Codex 会话。", at: event.at };
      }
      if (event.type === "session.ended") {
        markDisconnected("已断开");
        if (sessionEndedShown) return null;
        sessionEndedShown = true;
        return { kind: "system", title: "会话已断开", body: "当前手机配对已断开。", at: event.at };
      }
      if (event.type === "injector.notice") {
        return null;
      }
      if (event.type === "phone.input.failed" || event.type === "client.send_failed" || event.type === "error" || event.type === "warning") {
        return { kind: "error", title: "发送失败", body: event.message || "请求失败", at: event.at };
      }
      if (event.type.startsWith("phone.input.") || event.type === "client.send_result" || event.type === "app_server.thread.loaded") {
        return null;
      }
      if (event.type === "turn.started") {
        return { kind: "system", title: "开始执行", body: "Codex 开始处理当前输入。", at: event.at };
      }
      if (event.type === "turn.completed") {
        if (!event.text) return { kind: "system", title: "执行完成", body: "当前回合已完成。", at: event.at };
        return { kind: "assistant", title: "最终结果", body: event.text, at: event.at };
      }
      if (event.type === "user.message" || event.type === "local.user") {
        return { kind: "user", title: "你", body: event.text || event.message || "", at: event.at };
      }
      if (event.type === "assistant.message") {
        return { kind: "assistant", title: event.phase === "final" ? "最终回复" : "Codex", body: event.text || "", at: event.at };
      }
      if (event.type === "assistant.delta") {
        return { kind: "assistant-delta", title: "Codex", body: event.text || "", at: event.at, id: event.itemId || event.turnId || "assistant" };
      }
      if (event.type === "tool.started") {
        return { kind: "tool", title: "工具调用", body: toolName(event.label || event.source), at: event.at };
      }
      if (event.type === "tool.completed") {
        const failed = event.status && !["completed", "success", "0"].includes(String(event.status));
        if (!failed) return null;
        return { kind: "error", title: "工具失败", body: toolName(event.label || event.source) + " · " + event.status, at: event.at };
      }
      if (event.type === "context.compacted") {
        return { kind: "system", title: "上下文已整理", body: "Codex 已压缩上下文。", at: event.at };
      }
      return null;
    }

    function createCard(item) {
      const div = document.createElement("div");
      div.className = "event " + item.kind.replace("-delta", "");
      div.innerHTML = '<div class="meta"><span></span><time></time></div><div class="body"></div>';
      div.querySelector(".meta span").textContent = item.title;
      div.querySelector("time").textContent = timeText(item.at);
      div.querySelector(".body").textContent = item.body;
      eventsEl.appendChild(div);
      while (eventsEl.children.length > 300) eventsEl.removeChild(eventsEl.firstChild);
      eventsEl.parentElement.scrollTop = eventsEl.parentElement.scrollHeight;
      return div;
    }

    function append(event) {
      if (event.bridgeSeq) {
        lastSeq = Math.max(lastSeq, Number(event.bridgeSeq));
        if (seenSeq.has(event.bridgeSeq)) return;
        seenSeq.add(event.bridgeSeq);
      }
      const item = displayEvent(event);
      if (!item) return;
      if (item.kind === "assistant-delta") {
        const key = item.id;
        const text = (streamTextById.get(key) || "") + item.body;
        streamTextById.set(key, text);
        let node = streamNodeById.get(key);
        if (!node) {
          node = createCard({ ...item, kind: "assistant", body: text });
          streamNodeById.set(key, node);
        } else {
          node.querySelector(".body").textContent = text;
        }
        return;
      }
      const key = item.kind + ":" + item.title + ":" + item.body.trim();
      if ((item.kind === "assistant" || item.kind === "user") && shownMessageKeys.has(key)) return;
      shownMessageKeys.add(key);
      createCard(item);
    }

    async function pollOnce() {
      if (disconnected) return;
      try {
        const res = await fetch("/poll?token=" + encodeURIComponent(token) + "&since=" + encodeURIComponent(String(lastSeq)), {
          cache: "no-store"
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "poll failed");
        for (const event of payload.events || []) append(event);
        if (payload.deliveryInFlight) {
          statusEl.textContent = "正在发送手机输入";
        } else if (payload.activeTurnId) {
          statusEl.textContent = "Codex 正在执行";
        } else if ((payload.queued || 0) > 0) {
          statusEl.textContent = "已排队 " + payload.queued + " 条";
        } else {
          statusEl.textContent = "已连接";
        }
      } catch (error) {
        statusEl.textContent = "连接中断，正在重试";
      }
    }

    source = new EventSource("/events?token=" + encodeURIComponent(token));
    source.onopen = () => { statusEl.textContent = "已连接"; };
    source.onerror = () => { statusEl.textContent = "已连接，轮询同步"; };
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data);
        append(event);
      } catch {
        append({ type: "client.error", message: message.data, at: new Date().toISOString() });
      }
    };

    document.getElementById("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = textEl.value.trim();
      if (!text) return;
      sendEl.disabled = true;
      append({ type: "local.user", text, at: new Date().toISOString() });
      try {
        const res = await fetch("/input?token=" + encodeURIComponent(token), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text })
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "send failed");
        textEl.value = "";
        statusEl.textContent = payload.mode === "queue" ? "已排队" : "已发送";
        await pollOnce();
      } catch (error) {
        append({ type: "client.send_failed", message: String(error.message || error), at: new Date().toISOString() });
      } finally {
        sendEl.disabled = false;
      }
    });
    disconnectEl.addEventListener("click", async () => {
      if (disconnected) return;
      markDisconnected("正在断开");
      try {
        await fetch("/disconnect?token=" + encodeURIComponent(token), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}"
        });
      } catch {}
      append({ type: "session.ended", at: new Date().toISOString() });
      statusEl.textContent = "已断开";
    });
    pollOnce();
    pollTimer = setInterval(pollOnce, 1200);
  </script>
</body>
</html>`;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function unauthorized(res) {
  res.writeHead(401, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "invalid token" }));
}

function recordManagedDisconnect(reason) {
  const file = process.env.CODEX_TO_PHONE_DISCONNECT_FILE;
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ reason, at: nowIso() }, null, 2));
  } catch (error) {
    console.error(`Could not record phone disconnect: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function getLanHints(port, token) {
  const hints = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        hints.push(`http://${entry.address}:${port}/?token=${encodeURIComponent(token)}`);
      }
    }
  }
  return hints;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const useAppServer = !options.rolloutFile || options.injector === "app-server";
  const child = useAppServer ? spawnTransport(options.mode, options.sock) : null;
  const client = child ? new JsonRpcClient(child) : null;

  let threadId = options.threadId;
  let activeTurnId = "";
  let deliveryInFlight = false;
  const pendingInputs = [];
  const clients = new Set();
  const buffer = [];
  let nextEventSeq = 1;
  let stopTailer = null;
  let sessionEndedEmitted = false;

  function emit(event) {
    const payload = sanitizeJsonPayload({ ...event, bridgeSeq: nextEventSeq, bridgeThreadId: threadId });
    nextEventSeq += 1;
    buffer.push(payload);
    while (buffer.length > MAX_BUFFERED_EVENTS) buffer.shift();
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      res.write(line);
    }
  }

  function emitSessionEnded(reason) {
    if (sessionEndedEmitted) return;
    sessionEndedEmitted = true;
    emit({ type: "session.ended", reason, at: nowIso() });
  }

  async function sendNow(text) {
    if (!threadId) {
      throw new Error("No bound thread id");
    }
    const startedAtMs = Date.now();
    let response;
    if (options.injector === "debug") {
      response = await sendViaDebugInjector(text);
      if (options.rolloutFile) {
        const verification = await verifyBoundRolloutInput({
          rolloutFile: options.rolloutFile,
          threadId,
          text,
          startedAtMs,
        });
        if (!verification.ok) {
          throw new Error(
            verification.sideSession
              ? `${verification.reason}; sideSession=${verification.sideSession.threadId || "unknown"} file=${verification.sideSession.file}`
              : verification.reason,
          );
        }
        response = { ...response, verification };
      }
    } else if (options.injector === "ui") {
      response = await sendViaUiInjector(text);
      if (options.rolloutFile) {
        const verification = await verifyBoundRolloutInput({
          rolloutFile: options.rolloutFile,
          threadId,
          text,
          startedAtMs,
        });
        if (!verification.ok) {
          throw new Error(`UI injector did not reach the bound Desktop session: ${verification.reason}`);
        }
        response = { ...response, verification };
      }
    } else if (options.injector === "desktop-ipc") {
      response = await sendViaDesktopIpcInjector(text, threadId, options.desktopIpcSock);
      if (options.rolloutFile) {
        const verification = await verifyBoundRolloutInput({
          rolloutFile: options.rolloutFile,
          threadId,
          text,
          startedAtMs,
        });
        if (!verification.ok) {
          throw new Error(
            verification.sideSession
              ? `${verification.reason}; sideSession=${verification.sideSession.threadId || "unknown"} file=${verification.sideSession.file}`
              : verification.reason,
          );
        }
        response = { ...response, verification };
      }
    } else if (options.injector === "none") {
      response = { skipped: true };
    } else {
      if (!client) throw new Error("app-server injector is unavailable");
      response = await client.request(
        "turn/start",
        { threadId, input: [textInput(text)] },
        TURN_START_TIMEOUT_MS,
      );
      if (options.rolloutFile) {
        const verification = await verifyBoundRolloutInput({
          rolloutFile: options.rolloutFile,
          threadId,
          text,
          startedAtMs,
        });
        if (!verification.ok) {
          throw new Error(
            verification.sideSession
              ? `${verification.reason}; sideSession=${verification.sideSession.threadId || "unknown"} file=${verification.sideSession.file}`
              : verification.reason,
          );
        }
        response = { ...response, verification };
      }
    }
    emit({ type: "phone.input.sent", text, response, at: nowIso() });
  }

  function startInputDelivery(text) {
    deliveryInFlight = true;
    emit({ type: "phone.input.sending", text, injector: options.injector, at: nowIso() });
    void (async () => {
      try {
        await sendNow(text);
      } catch (error) {
        emit({
          type: "phone.input.failed",
          text,
          message: explainInjectorError(error, options.injector),
          rawMessage: error instanceof Error ? error.message : String(error),
          action:
            options.injector === "ui"
              ? "grant_macos_accessibility_permission_or_use_official_injection_api"
              : options.injector === "desktop-ipc"
                ? "keep_matching_codex_desktop_thread_open_and_retry"
                : "check_injector",
          at: nowIso(),
        });
      } finally {
        deliveryInFlight = false;
        queueMicrotask(() => flushQueue());
      }
    })();
  }

  function flushQueue() {
    if (activeTurnId || deliveryInFlight || pendingInputs.length === 0) return;
    const next = pendingInputs.shift();
    emit({ type: "phone.input.dequeued", text: next.text, queued: pendingInputs.length, at: nowIso() });
    startInputDelivery(next.text);
  }

  if (client) {
    client.onNotification((method, params) => {
      const event = normalizeEvent(method, params);
      if (!event) return;
      if (event.threadId && threadId && event.threadId !== threadId) return;
      if (event.type === "turn.started") {
        activeTurnId = event.turnId;
      }
      if (event.type === "turn.completed") {
        activeTurnId = "";
        queueMicrotask(() => void flushQueue());
      }
      emit(event);
    });

    client.onRequest((method, params) => {
      emit({
        type: "app_server.request.unsupported",
        method,
        message: "Remote approvals are not supported in this MVP. Handle approvals on the PC.",
        params,
        at: nowIso(),
      });
      throw new Error(`Unsupported app-server request in mobile bridge: ${method}`);
    });
  }

  if (client && options.initialize) {
    await client.request("initialize", appServerInitializeParams());
    client.notify("initialized", {});
  }

  if (!threadId && options.rolloutFile) {
    const firstLine = fs.readFileSync(options.rolloutFile, "utf8").split(/\n/u).find(Boolean);
    if (firstLine) {
      const record = JSON.parse(firstLine);
      threadId = record?.payload?.id || "";
    }
  }

  if (!threadId && options.autoBind) {
    if (!client) throw new Error("--auto-bind requires app-server mode");
    const loaded = await client.request("thread/loaded/list", {});
    const ids = Array.isArray(loaded?.data) ? loaded.data.filter((id) => typeof id === "string") : [];
    if (ids.length === 1) {
      threadId = ids[0];
    } else {
      throw new Error(
        ids.length === 0
          ? "No loaded Codex thread found. Pass --thread-id."
          : `Multiple loaded threads found (${ids.join(", ")}). Pass --thread-id.`,
      );
    }
  }

  if (!threadId) {
    throw new Error("Missing --thread-id. Use --auto-bind only when exactly one loaded thread exists.");
  }

  if (client) {
    const loadResult = await ensureThreadLoaded(client, threadId);
    emit({
      type: "app_server.thread.loaded",
      threadId,
      alreadyLoaded: loadResult.alreadyLoaded,
      at: nowIso(),
    });
  }

  emit({ type: "session.started", threadId, at: nowIso() });
  if (options.injector === "ui") {
    emit({
      type: "injector.notice",
      message: [
        "当前使用临时 macOS UI 注入器。手机输入需要 macOS 允许注入器通过辅助功能发送按键。",
        fs.existsSync(UI_HELPER_APP)
          ? `已安装专用 Helper App：${UI_HELPER_APP}。建议在辅助功能里优先允许 Codex Live Session Input。`
          : "尚未安装专用 Helper App，当前会回退到 osascript。",
      ].join("\n"),
      at: nowIso(),
    });
  }
  if (options.injector === "desktop-ipc") {
    emit({
      type: "injector.notice",
      message: [
        "当前使用 Codex Desktop IPC 注入器。",
        "手机输入会通过当前打开的 Codex Desktop 会话窗口发起回合，PC 端应能看到完整回复过程。",
        `IPC socket: ${options.desktopIpcSock || defaultDesktopIpcSocketPath()}`,
      ].join("\n"),
      at: nowIso(),
    });
  }
  if (options.rolloutFile) {
    seedRolloutBackfill(
      options.rolloutFile,
      options.backfillLines,
      emit,
      (turnId) => {
        activeTurnId = turnId;
      },
    );
    activeTurnId = detectActiveTurnFromRollout(options.rolloutFile);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const token = url.searchParams.get("token") ?? "";
      if (url.pathname !== "/" && token !== options.token) {
        unauthorized(res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderPhonePage());
        return;
      }
      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            threadId,
            activeTurnId,
            deliveryInFlight,
            queued: pendingInputs.length,
            bufferLength: buffer.length,
            nextEventSeq,
          }),
        );
        return;
      }
      if (req.method === "GET" && url.pathname === "/poll") {
        const since = Number(url.searchParams.get("since") ?? "0");
        const events = buffer.filter((event) => {
          if (!Number.isFinite(since) || since < 1) return true;
          return Number(event.bridgeSeq ?? 0) > since;
        });
        res.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(
          JSON.stringify({
            ok: true,
            events,
            nextEventSeq,
            activeTurnId,
            deliveryInFlight,
            queued: pendingInputs.length,
          }),
        );
        return;
      }
      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        res.flushHeaders?.();
        clients.add(res);
        res.write(": connected\n\n");
        for (const event of buffer) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        req.on("close", () => clients.delete(res));
        return;
      }
      if (req.method === "POST" && url.pathname === "/input") {
        const body = await readJsonBody(req);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "text is required" }));
          return;
        }
        console.log(
          `[bridge] phone input received length=${text.length} activeTurn=${activeTurnId || "none"}`,
        );
        emit({ type: "phone.input.accepted", text, at: nowIso() });
        if (activeTurnId) {
          if (options.activePolicy === "reject") {
            res.writeHead(409, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "turn is active" }));
            return;
          }
          if (options.activePolicy === "steer") {
            if (!client) {
              res.writeHead(409, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "steer requires app-server mode" }));
              return;
            }
            await client.request("turn/steer", {
              threadId,
              expectedTurnId: activeTurnId,
              input: [textInput(text)],
            });
            emit({ type: "phone.input.steered", text, turnId: activeTurnId, at: nowIso() });
            res.writeHead(202, { "content-type": "application/json" });
            res.end(JSON.stringify({ accepted: true, mode: "steer" }));
            return;
          }
          pendingInputs.push({ text });
          console.log(`[bridge] phone input queued count=${pendingInputs.length}`);
          emit({ type: "phone.input.queued", text, queued: pendingInputs.length, at: nowIso() });
          res.writeHead(202, { "content-type": "application/json" });
          res.end(JSON.stringify({ accepted: true, mode: "queue", queued: pendingInputs.length }));
          return;
        }
        if (deliveryInFlight) {
          pendingInputs.push({ text });
          console.log(`[bridge] phone input queued count=${pendingInputs.length}`);
          emit({ type: "phone.input.queued", text, queued: pendingInputs.length, at: nowIso() });
          res.writeHead(202, { "content-type": "application/json" });
          res.end(JSON.stringify({ accepted: true, mode: "queue", queued: pendingInputs.length }));
          return;
        }
        startInputDelivery(text);
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ accepted: true, mode: "start", deliveryInFlight: true }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/disconnect") {
        const reason = "phone disconnect";
        recordManagedDisconnect(reason);
        emitSessionEnded(reason);
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ disconnected: true }));
        setTimeout(() => shutdown(reason), 80);
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise((resolve) => server.listen(options.port, options.host, resolve));
  stopTailer = options.rolloutFile
    ? createRolloutTailer(
        options.rolloutFile,
        emit,
        (turnId) => {
          activeTurnId = turnId;
          if (!turnId) queueMicrotask(() => void flushQueue());
        },
      )
    : null;
  const baseUrl =
    options.publicUrl ||
    `http://${options.host === "0.0.0.0" ? "127.0.0.1" : options.host}:${options.port}`;
  const phoneUrl = `${baseUrl.replace(/\/+$/u, "")}/?token=${encodeURIComponent(options.token)}`;
  console.log(`Codex Live Session Bridge running`);
  console.log(`threadId: ${threadId}`);
  console.log(`transport: ${options.rolloutFile ? "rollout" : options.mode}`);
  console.log(`injector: ${options.injector}`);
  if (options.rolloutFile) console.log(`rollout: ${options.rolloutFile}`);
  console.log(`phone URL: ${phoneUrl}`);
  if (options.host === "0.0.0.0" && !options.publicUrl) {
    const hints = getLanHints(options.port, options.token);
    if (hints.length > 0) {
      console.log("LAN URL candidates:");
      for (const hint of hints) console.log(`  ${hint}`);
    }
  }

  function shutdown(reason = "bridge shutdown") {
    emitSessionEnded(reason);
    stopTailer?.();
    server.close();
    client?.dispose();
    if (reason === "phone disconnect" && process.env.CODEX_TO_PHONE_MANAGED_BRIDGE === "1") {
      try {
        process.kill(process.ppid, "SIGTERM");
      } catch {}
    }
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
