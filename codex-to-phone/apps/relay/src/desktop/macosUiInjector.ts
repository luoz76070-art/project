import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Windows SEA bundles are CommonJS; only macOS needs this app resource path.
const rootDir = process.platform === "darwin"
  ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
  : process.cwd();
const helperApp = path.join(rootDir, "Mobile Codex Input.app");
const helperExec = path.join(helperApp, "Contents", "MacOS", "MobileCodexInput");
let inputQueue: Promise<unknown> = Promise.resolve();
let queuedInputs = 0;

async function withInputTransaction<T>(action: () => Promise<T>): Promise<T> {
  if (queuedInputs >= 16) throw Object.assign(new Error("Desktop input queue is busy"), { statusCode: 503 });
  queuedInputs++;
  const pending = inputQueue.then(action, action);
  inputQueue = pending.catch(() => undefined);
  try { return await pending; } finally { queuedInputs--; }
}

export type MacosUiInjectorStatus = {
  platform: NodeJS.Platform;
  available: boolean;
  helperApp: string;
  helperInstalled: boolean;
  fallback: "osascript";
  focusDelayMs: number;
};

export type MacosUiInjectionResult = {
  focus: {
    url: string;
    stdout: string;
    stderr: string;
  };
  injection: {
    method: "helper-app" | "osascript";
    stdout: string;
    stderr: string;
    helperApp?: string;
    requestId?: string;
  };
};

export class MacosUiInjector {
  private readonly focusDelayMs = Number(process.env.MOBILE_CODEX_MAC_FOCUS_DELAY_MS ?? 900);
  private readonly helperResultTimeoutMs = Number(process.env.MOBILE_CODEX_MAC_HELPER_TIMEOUT_MS ?? 4_500);

  constructor(private readonly options: {
    run?: typeof runCommand;
    helperExec?: string;
    platform?: NodeJS.Platform;
    focusDelayMs?: number;
  } = {}) {}

  private get run() { return this.options.run ?? runCommand; }

  status(): MacosUiInjectorStatus {
    return {
      platform: process.platform,
      available: process.platform === "darwin",
      helperApp,
      helperInstalled: fs.existsSync(helperExec),
      fallback: "osascript",
      focusDelayMs: this.focusDelayMs,
    };
  }

  async sendMessage(params: { threadId: string; message: string }): Promise<MacosUiInjectionResult> {
    if ((this.options.platform ?? process.platform) !== "darwin") {
      throw new Error("macos-ui-injector is only available on macOS");
    }
    return withInputTransaction(async () => {
      const focus = await this.focusThread(params.threadId);
      await delay(this.options.focusDelayMs ?? this.focusDelayMs);
      const injection = fs.existsSync(this.options.helperExec ?? helperExec)
        ? await this.sendViaHelperApp(params.message)
        : await this.sendViaAppleScript(params.message);
      return { focus, injection };
    });
  }

  private async focusThread(threadId: string): Promise<MacosUiInjectionResult["focus"]> {
    const url = `codex://threads/${encodeURIComponent(threadId)}`;
    const result = await this.run("open", [url], 5_000, "Timed out focusing Codex thread");
    return { url, ...result };
  }

  private async sendViaHelperApp(message: string): Promise<MacosUiInjectionResult["injection"]> {
    const requestId = randomUUID();
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "mobile-codex-input-"));
    await fsp.chmod(directory, 0o700);
    const inputFile = path.join(directory, "input.txt");
    const requestFile = path.join(directory, "request.json");
    const resultFile = path.join(directory, "result.json");
    try {
      await fsp.writeFile(inputFile, message, { mode: 0o600 });
      await fsp.writeFile(requestFile, JSON.stringify({ id: requestId, inputFile, resultFile, expiresAt: Date.now() + this.helperResultTimeoutMs }), { mode: 0o600 });
      // Own the child so a timeout terminates this exact transaction before the next input.
      const launched = await this.run(this.options.helperExec ?? helperExec, ["--request", requestFile], this.helperResultTimeoutMs, "Input result is unknown; check Desktop before retrying");
      const result = JSON.parse(await fsp.readFile(resultFile, "utf8")) as { id?: string; ok?: boolean; message?: string };
      if (result.id !== requestId || !result.ok) throw new Error(result.message ?? "Input helper did not confirm submission");
      return { method: "helper-app", stdout: result.message ?? launched.stdout, stderr: launched.stderr, helperApp, requestId };
    } catch (error) {
      throw new Error(`Desktop input was not replayed. Check the thread before retrying: ${toErrorMessage(error)}`);
    } finally { await fsp.rm(directory, { recursive: true, force: true }); }
  }

  private async sendViaAppleScript(message: string): Promise<MacosUiInjectionResult["injection"]> {
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
    const result = await this.run("osascript", ["-e", script, message], 10_000, "Timed out waiting for macOS UI injector");
    return { method: "osascript", ...result };
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  timeoutMessage: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-8192);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) { reject(new Error(timeoutMessage)); return; }
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error((stderr || stdout || `${command} exited ${code}`).trim()));
      }
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
