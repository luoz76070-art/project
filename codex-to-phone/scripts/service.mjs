#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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
const URL_FILE = path.join(STATE_DIR, "phone-url.txt");
const DISCONNECT_FILE = path.join(STATE_DIR, "disconnected.json");
const QR_IMAGE_FILE = path.join(STATE_DIR, "pairing-qr.png");
const LAN_URL_FILE = path.join(STATE_DIR, "lan-url.txt");
const LAN_QR_IMAGE_FILE = path.join(STATE_DIR, "pairing-qr-lan.png");
const QUICK_TUNNEL_HOST_RE = String.raw`[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+){2,}\.trycloudflare\.com`;
const PHONE_URL_RE = new RegExp(`https://${QUICK_TUNNEL_HOST_RE}/\\?token=[A-Za-z0-9_-]+`, "u");
const CLOUDFLARE_URL_RE = new RegExp(`https://${QUICK_TUNNEL_HOST_RE}`, "u");
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

function hasDisconnectMarker() {
  return fs.existsSync(DISCONNECT_FILE);
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

function stopPid(pid) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
}

async function waitUntilStopped(pid, timeoutMs = 5_000) {
  const started = Date.now();
  while (isRunning(pid) && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function readLog() {
  try {
    return fs.readFileSync(LOG_FILE, "utf8");
  } catch {
    return "";
  }
}

function readUrlFile(file = URL_FILE) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function extractPhoneUrl(logText = readLog(), token = "", urlFile = URL_FILE) {
  const fileUrl = readUrlFile(urlFile);
  if (PHONE_URL_RE.test(fileUrl)) return fileUrl;
  const directUrl = logText.match(PHONE_URL_RE)?.[0] ?? "";
  if (directUrl) return directUrl;
  const publicUrl = logText.match(CLOUDFLARE_URL_RE)?.[0] ?? "";
  return publicUrl && token ? `${publicUrl}/?token=${encodeURIComponent(token)}` : "";
}

function extractToken(url) {
  try {
    return new URL(url).searchParams.get("token") ?? "";
  } catch {
    return "";
  }
}

function qrImageFileForUrl(file, url) {
  const parsed = path.parse(file || QR_IMAGE_FILE);
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
  return path.join(parsed.dir, `${parsed.name}-${hash}${parsed.ext || ".png"}`);
}

async function writePairingQrImage(url, file = QR_IMAGE_FILE) {
  const qrcode = require("qrcode");
  const imageFile = qrImageFileForUrl(file, url);
  fs.mkdirSync(path.dirname(imageFile), { recursive: true });
  await qrcode.toFile(imageFile, url, {
    type: "png",
    width: 720,
    margin: 4,
    errorCorrectionLevel: "M",
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });
  return imageFile;
}

function printTerminalQrCode(url) {
  try {
    const qrcode = require("qrcode-terminal");
    qrcode.generate(url, { small: true });
  } catch {
    console.log("QR code dependency is not installed. Run npm install to enable QR output.");
  }
}

async function printPairingQr(url, file = QR_IMAGE_FILE) {
  try {
    const imageFile = await writePairingQrImage(url, file);
    console.log("QR image:");
    console.log(imageFile);
  } catch {
    console.log("QR image generation failed. Terminal QR fallback:");
    printTerminalQrCode(url);
  }
}

function isUsableLanAddress(address) {
  if (!address || address === "127.0.0.1") return false;
  if (address.startsWith("169.254.")) return false;
  if (address.startsWith("198.18.") || address.startsWith("198.19.")) return false;
  return true;
}

function getLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isUsableLanAddress(entry.address)) {
        return entry.address;
      }
    }
  }
  return "";
}

function lanUrlForToken(token, port = 8765) {
  const address = getLanAddress();
  return address ? `http://${address}:${port}/?token=${encodeURIComponent(token)}` : "";
}

async function printLanQr(state) {
  const token = state?.token ?? "";
  if (!token) throw new Error("No pairing token found. Restart Codex To Phone first.");
  const url = lanUrlForToken(token);
  if (!url) throw new Error("No LAN address found. Connect the computer to Wi-Fi or Ethernet first.");
  fs.writeFileSync(state?.lanUrlFile ?? LAN_URL_FILE, `${url}\n`);
  await printPairingQr(url, state?.lanQrImageFile ?? LAN_QR_IMAGE_FILE);
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

async function waitForPhoneUrl(waitMs, token = "") {
  const started = Date.now();
  while (Date.now() - started < waitMs) {
    const url = extractPhoneUrl(readLog(), token);
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return "";
}

async function start(options) {
  ensureStateDir();
  const existing = readState();
  if (hasDisconnectMarker()) {
    if (existing && isRunning(existing.pid)) {
      stopPid(existing.pid);
      await waitUntilStopped(existing.pid);
      if (isRunning(existing.pid)) {
        throw new Error(`Timed out stopping disconnected Codex To Phone service. pid=${existing.pid}`);
      }
    }
    fs.rmSync(PID_FILE, { force: true });
    fs.rmSync(URL_FILE, { force: true });
    fs.rmSync(LAN_URL_FILE, { force: true });
    fs.rmSync(DISCONNECT_FILE, { force: true });
  } else if (existing && isRunning(existing.pid)) {
    const url = extractPhoneUrl(readLog(), existing.token ?? "", existing.urlFile ?? URL_FILE);
    console.log(`Codex To Phone is already running. pid=${existing.pid}`);
    if (url) {
      await printPairingQr(url, existing.qrImageFile ?? QR_IMAGE_FILE);
    }
    return;
  }

  fs.writeFileSync(LOG_FILE, `# Codex To Phone service ${new Date().toISOString()}\n`);
  fs.rmSync(URL_FILE, { force: true });
  fs.rmSync(QR_IMAGE_FILE, { force: true });
  fs.rmSync(LAN_URL_FILE, { force: true });
  fs.rmSync(LAN_QR_IMAGE_FILE, { force: true });
  const out = fs.openSync(LOG_FILE, "a");
  const token = randomBytes(18).toString("base64url");
  const child = spawn(
    process.execPath,
    [
      path.join(ROOT_DIR, "scripts", "start-cloudflare-tunnel.mjs"),
      ...options.passthrough,
      "--host",
      "0.0.0.0",
      "--token",
      token,
      "--url-file",
      URL_FILE,
      "--qr-image-file",
      QR_IMAGE_FILE,
    ],
    {
      cwd: ROOT_DIR,
      detached: true,
      env: { ...process.env, CODEX_TO_PHONE_DISCONNECT_FILE: DISCONNECT_FILE },
      stdio: ["ignore", out, out],
    },
  );
  child.unref();
  fs.writeFileSync(
    PID_FILE,
    JSON.stringify(
      {
        pid: child.pid,
        token,
        startedAt: new Date().toISOString(),
        logFile: LOG_FILE,
        urlFile: URL_FILE,
        qrImageFile: QR_IMAGE_FILE,
        lanUrlFile: LAN_URL_FILE,
        lanQrImageFile: LAN_QR_IMAGE_FILE,
      },
      null,
      2,
    ),
  );

  console.log(`Starting Codex To Phone in background. pid=${child.pid}`);
  const url = await waitForPhoneUrl(options.waitMs, token);
  if (url) {
    console.log("");
    await printPairingQr(url, QR_IMAGE_FILE);
  } else {
    console.log(`Still waiting for the public tunnel. Check log: ${LOG_FILE}`);
  }
}

async function status() {
  const state = readState();
  const url = extractPhoneUrl(readLog(), state?.token ?? "", state?.urlFile ?? URL_FILE);
  const running = state ? isRunning(state.pid) : false;
  console.log(JSON.stringify({
    running,
    pid: state?.pid ?? null,
    pairingReady: Boolean(url),
    lanPairingReady: Boolean(state?.token && getLanAddress()),
    logFile: LOG_FILE,
  }, null, 2));
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
    const state = readState();
    const url = extractPhoneUrl(readLog(), state?.token ?? "", state?.urlFile ?? URL_FILE);
    if (!url) throw new Error("No pairing QR found. Start the service first.");
    await printPairingQr(url, state?.qrImageFile ?? QR_IMAGE_FILE);
  } else if (options.command === "lan") {
    const state = readState();
    if (!state || !isRunning(state.pid)) throw new Error("Codex To Phone is not running.");
    await printLanQr(state);
  } else {
    throw new Error("Usage: node scripts/service.mjs <start|stop|status|url|lan> [start options]");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
