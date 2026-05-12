#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const DEFAULT_PORT = 8765;
const CLOUDFLARE_URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/u;
const PHONE_URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com\/\?token=[A-Za-z0-9_-]+/u;
const ANY_URL_RE = /https?:\/\/[^\s|]+/gu;
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const options = {
    port: DEFAULT_PORT,
    token: randomBytes(18).toString("base64url"),
    rolloutFile: "",
    threadId: "",
    injector: "desktop-ipc",
    desktopIpcSock: "",
    urlFile: "",
    qrImageFile: path.join(os.homedir(), ".codex-to-phone", "pairing-qr.png"),
    bridgeScript: path.join(path.dirname(new URL(import.meta.url).pathname), "bridge.mjs"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value after ${arg}`);
      return argv[i];
    };
    if (arg === "--port") options.port = Number(next());
    else if (arg === "--token") options.token = next();
    else if (arg === "--rollout-file") options.rolloutFile = next();
    else if (arg === "--thread-id") options.threadId = next();
    else if (arg === "--injector") options.injector = next();
    else if (arg === "--desktop-ipc-sock") options.desktopIpcSock = next();
    else if (arg === "--url-file") options.urlFile = next();
    else if (arg === "--qr-image-file") options.qrImageFile = next();
    else if (arg === "--bridge-script") options.bridgeScript = next();
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
  if (!["app-server", "debug", "desktop-ipc", "ui", "none"].includes(options.injector)) {
    throw new Error("--injector must be app-server, debug, desktop-ipc, ui, or none");
  }
  return options;
}

function printHelp() {
  console.log(`Start Codex Live Session through Cloudflare Tunnel

Usage:
  node plugins/codex-live-session/scripts/start-cloudflare-tunnel.mjs
  node plugins/codex-live-session/scripts/start-cloudflare-tunnel.mjs --rollout-file <file> --thread-id <id>

Options:
  --port <port>              Local bridge port. Default: ${DEFAULT_PORT}
  --token <token>            Override generated pairing token.
  --rollout-file <path>      Codex Desktop rollout JSONL file.
  --thread-id <id>           Codex session/thread id.
  --injector <mode>          Phone input injector: app-server, desktop-ipc, ui, debug, or none. Default: desktop-ipc.
  --desktop-ipc-sock <path>  Optional Codex Desktop IPC socket for desktop-ipc mode.
  --url-file <path>          Optional file that receives the generated phone URL for service management.
  --qr-image-file <path>     File that receives the generated PNG QR image.
  --bridge-script <path>     Override bridge.mjs path.
`);
}

function codexSessionsDir() {
  return path.join(os.homedir(), ".codex", "sessions");
}

function collectJsonlFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }
  return out;
}

function latestRolloutFile() {
  const files = collectJsonlFiles(codexSessionsDir());
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] ?? "";
}

function readFirstJsonLine(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(Math.min(fs.statSync(file).size, 1024 * 1024));
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const first = buffer.subarray(0, bytes).toString("utf8").split(/\n/u).find(Boolean);
    return first ? JSON.parse(first) : null;
  } finally {
    fs.closeSync(fd);
  }
}

function inferThreadId(file) {
  const first = readFirstJsonLine(file);
  const id = first?.payload?.id;
  return typeof id === "string" ? id : "";
}

function ensureBinary(name) {
  const paths = (process.env.PATH ?? "").split(path.delimiter);
  for (const dir of paths) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing ${name}. Install it first, for example: brew install cloudflared`);
}

function waitForBridge(port, token) {
  const url = `http://127.0.0.1:${port}/health?token=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode === 200) {
            resolve();
          } else {
            retry();
          }
        })
        .on("error", retry);
    };
    const retry = () => {
      if (Date.now() - started > 10_000) {
        reject(new Error("Timed out waiting for local bridge"));
      } else {
        setTimeout(tick, 300);
      }
    };
    tick();
  });
}

function redactUrls(text) {
  return text.replace(PHONE_URL_RE, "[phone pairing QR hidden]").replace(ANY_URL_RE, "[URL hidden]");
}

function pipeOutput(child, prefix, onText, options = {}) {
  const handle = (chunk) => {
    const text = chunk.toString();
    const output = options.redactUrls ? redactUrls(text) : text;
    process.stdout.write(output.split(/\n/u).map((line) => (line ? `[${prefix}] ${line}` : line)).join("\n"));
    if (!text.endsWith("\n")) process.stdout.write("\n");
    onText?.(text);
  };
  child.stdout.on("data", handle);
  child.stderr.on("data", handle);
}

function writePhoneUrlFile(file, url) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${url}\n`);
}

async function writeQrImage(file, url) {
  if (!file) return "";
  const qrcode = require("qrcode");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await qrcode.toFile(file, url, {
    type: "png",
    width: 720,
    margin: 4,
    errorCorrectionLevel: "M",
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });
  return file;
}

function printTerminalQrCode(url) {
  try {
    const qrcode = require("qrcode-terminal");
    qrcode.generate(url, { small: true });
  } catch {
    console.log("QR code dependency is not installed. Run npm install to enable terminal QR output.");
  }
}

async function printPhoneQr(url, file) {
  try {
    const imageFile = await writeQrImage(file, url);
    console.log("\nCodex Live Session phone QR image:");
    console.log(imageFile);
    console.log("\nScan the QR image on the phone from Wi-Fi or cellular data.");
  } catch {
    console.log("\nCodex Live Session terminal QR fallback:");
    printTerminalQrCode(url);
    console.log("\nScan the QR code on the phone from Wi-Fi or cellular data.");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureBinary("cloudflared");

  const rolloutFile = options.rolloutFile || latestRolloutFile();
  if (!rolloutFile) throw new Error("Could not find a Codex rollout JSONL file");
  const threadId = options.threadId || inferThreadId(rolloutFile);
  if (!threadId) throw new Error(`Could not infer thread id from ${rolloutFile}`);

  const bridgeArgs = [
    options.bridgeScript,
    "--rollout-file",
    rolloutFile,
    "--thread-id",
    threadId,
    "--injector",
    options.injector,
    "--host",
    "127.0.0.1",
    "--port",
    String(options.port),
    "--token",
    options.token,
  ];
  if (options.desktopIpcSock) {
    bridgeArgs.push("--desktop-ipc-sock", options.desktopIpcSock);
  }

  const bridge = spawn("node", bridgeArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  pipeOutput(bridge, "bridge", null, { redactUrls: true });
  bridge.on("exit", (code, signal) => {
    console.error(`[bridge] exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    process.exitCode = 1;
  });

  await waitForBridge(options.port, options.token);

  let printedUrl = false;
  const tunnel = spawn("cloudflared", [
    "tunnel",
    "--no-autoupdate",
    "--protocol",
    "http2",
    "--url",
    `http://127.0.0.1:${options.port}`,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  pipeOutput(tunnel, "cloudflared", (text) => {
    const match = text.match(CLOUDFLARE_URL_RE);
    if (match && !printedUrl) {
      printedUrl = true;
      const phoneUrl = `${match[0]}/?token=${encodeURIComponent(options.token)}`;
      writePhoneUrlFile(options.urlFile, phoneUrl);
      void printPhoneQr(phoneUrl, options.qrImageFile);
    }
  }, { redactUrls: true });

  tunnel.on("exit", (code, signal) => {
    console.error(`[cloudflared] exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    bridge.kill("SIGTERM");
    process.exitCode = 1;
  });

  const shutdown = () => {
    tunnel.kill("SIGTERM");
    bridge.kill("SIGTERM");
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`Local bridge is running for thread ${threadId}`);
  console.log(`Rollout file: ${rolloutFile}`);
  console.log("Waiting for Cloudflare public URL...");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
