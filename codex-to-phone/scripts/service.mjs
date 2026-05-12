#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const STATE_DIR = path.join(os.homedir(), ".codex-to-phone");
const PID_FILE = path.join(STATE_DIR, "service.json");
const LOG_FILE = path.join(STATE_DIR, "service.log");
const URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com\/\?token=[A-Za-z0-9_-]+/u;
const DEFAULT_WAIT_MS = 60_000;

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
  } catch {
    return null;
  }
}

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLog() {
  try {
    return fs.readFileSync(LOG_FILE, "utf8");
  } catch {
    return "";
  }
}

function extractPhoneUrl(logText = readLog()) {
  return logText.match(URL_RE)?.[0] ?? "";
}

function extractToken(url) {
  try {
    return new URL(url).searchParams.get("token") ?? "";
  } catch {
    return "";
  }
}

function printQrCode(url) {
  try {
    const qrcode = require("qrcode-terminal");
    qrcode.generate(url, { small: true });
  } catch {
    console.log("QR code dependency is not installed. Run npm install to enable QR output.");
  }
}

function parseArgs(argv) {
  const [command = "status", ...rest] = argv;
  const options = {
    command,
    waitMs: DEFAULT_WAIT_MS,
    passthrough: [],
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--wait-ms") {
      i += 1;
      options.waitMs = Number(rest[i]);
    } else {
      options.passthrough.push(arg);
    }
  }
  return options;
}

function healthUrlFromPhoneUrl(phoneUrl) {
  const token = extractToken(phoneUrl);
  return token ? `http://127.0.0.1:8765/health?token=${encodeURIComponent(token)}` : "";
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

async function waitForPhoneUrl(waitMs) {
  const started = Date.now();
  while (Date.now() - started < waitMs) {
    const url = extractPhoneUrl();
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return "";
}

async function start(options) {
  ensureStateDir();
  const existing = readState();
  if (existing && isRunning(existing.pid)) {
    const url = extractPhoneUrl();
    console.log(`Codex To Phone is already running. pid=${existing.pid}`);
    if (url) {
      console.log(url);
      printQrCode(url);
    }
    return;
  }

  fs.writeFileSync(LOG_FILE, `# Codex To Phone service ${new Date().toISOString()}\n`);
  const out = fs.openSync(LOG_FILE, "a");
  const child = spawn(
    process.execPath,
    [path.join(ROOT_DIR, "scripts", "start-cloudflare-tunnel.mjs"), ...options.passthrough],
    {
      cwd: ROOT_DIR,
      detached: true,
      env: process.env,
      stdio: ["ignore", out, out],
    },
  );
  child.unref();
  fs.writeFileSync(
    PID_FILE,
    JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), logFile: LOG_FILE }, null, 2),
  );

  console.log(`Starting Codex To Phone in background. pid=${child.pid}`);
  const url = await waitForPhoneUrl(options.waitMs);
  if (url) {
    console.log("\nPhone URL:");
    console.log(url);
    console.log("\nScan this QR code:");
    printQrCode(url);
  } else {
    console.log(`Still waiting for the public URL. Check log: ${LOG_FILE}`);
  }
}

async function status() {
  const state = readState();
  const url = extractPhoneUrl();
  const running = state ? isRunning(state.pid) : false;
  console.log(JSON.stringify({ running, pid: state?.pid ?? null, url: url || null, logFile: LOG_FILE }, null, 2));
  const healthUrl = url ? healthUrlFromPhoneUrl(url) : "";
  if (running && healthUrl) {
    try {
      const health = await getJson(healthUrl);
      console.log(JSON.stringify({ bridge: health }, null, 2));
    } catch {
      console.log("Bridge health check is not reachable yet.");
    }
  }
}

function stop() {
  const state = readState();
  if (!state || !isRunning(state.pid)) {
    console.log("Codex To Phone is not running.");
    return;
  }
  try {
    process.kill(-state.pid, "SIGTERM");
  } catch {
    process.kill(state.pid, "SIGTERM");
  }
  console.log(`Stopped Codex To Phone. pid=${state.pid}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "start") {
    await start(options);
  } else if (options.command === "stop") {
    stop();
  } else if (options.command === "status") {
    await status();
  } else if (options.command === "url") {
    const url = extractPhoneUrl();
    if (!url) throw new Error("No phone URL found. Start the service first.");
    console.log(url);
    printQrCode(url);
  } else {
    throw new Error("Usage: node scripts/service.mjs <start|stop|status|url> [start options]");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
