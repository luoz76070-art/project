import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const helperApp = path.join(rootDir, "Mobile Codex Input.app");
const helperExec = path.join(helperApp, "Contents", "MacOS", "MobileCodexInput");
const inputFile = "/tmp/mobile-codex-input.txt";
const requestFile = "/tmp/mobile-codex-input-request.json";
const resultFile = "/tmp/mobile-codex-input-result.json";

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
    if (process.platform !== "darwin") {
      throw new Error("macos-ui-injector is only available on macOS");
    }
    const focus = await this.focusThread(params.threadId);
    await delay(this.focusDelayMs);
    const injection = fs.existsSync(helperApp) ? await this.sendViaHelperAppWithFallback(params.message) : await this.sendViaAppleScript(params.message);
    return { focus, injection };
  }

  private async focusThread(threadId: string): Promise<MacosUiInjectionResult["focus"]> {
    const url = `codex://threads/${encodeURIComponent(threadId)}`;
    const result = await runCommand("open", [url], 5_000, "Timed out focusing Codex thread");
    return { url, ...result };
  }

  private async sendViaHelperApp(message: string): Promise<MacosUiInjectionResult["injection"]> {
    const requestId = randomUUID();
    await stopHelperProcesses();
    await fsp.rm(resultFile, { force: true });
    await fsp.writeFile(inputFile, message, { mode: 0o600 });
    await fsp.writeFile(requestFile, `${JSON.stringify({ id: requestId, inputFile })}\n`, { mode: 0o600 });
    const launched = await runCommand("open", ["-n", helperApp], 10_000, "Timed out launching Mobile Codex Input helper");
    await resumeHelperProcesses();
    await delay(120);
    await resumeHelperProcesses();
    const result = await waitForHelperResult(requestId, this.helperResultTimeoutMs, resumeHelperProcesses);
    return {
      method: "helper-app",
      stdout: result.message || launched.stdout,
      stderr: launched.stderr,
      helperApp,
      requestId,
    };
  }

  private async sendViaHelperAppWithFallback(message: string): Promise<MacosUiInjectionResult["injection"]> {
    try {
      return await this.sendViaHelperApp(message);
    } catch (helperError) {
      await stopHelperProcesses();
      try {
        const fallback = await this.sendViaAppleScript(message);
        return {
          ...fallback,
          stderr: [`helper failed: ${toErrorMessage(helperError)}`, fallback.stderr].filter(Boolean).join("\n"),
        };
      } catch (fallbackError) {
        throw new Error(
          `Mobile Codex Input helper failed: ${toErrorMessage(helperError)}; AppleScript fallback failed: ${toErrorMessage(fallbackError)}`,
        );
      }
    }
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
    const result = await runCommand("osascript", ["-e", script, message], 10_000, "Timed out waiting for macOS UI injector");
    return { method: "osascript", ...result };
  }
}

async function waitForHelperResult(
  requestId: string,
  timeoutMs: number,
  onPoll?: () => Promise<void>,
): Promise<{ ok: boolean; message: string; code: number }> {
  const startedAt = Date.now();
  let nextPollAt = 0;
  while (Date.now() - startedAt < timeoutMs) {
    if (onPoll && Date.now() >= nextPollAt) {
      await onPoll();
      nextPollAt = Date.now() + 300;
    }
    if (fs.existsSync(resultFile)) {
      try {
        const result = JSON.parse(await fsp.readFile(resultFile, "utf8")) as {
          id?: unknown;
          ok?: unknown;
          message?: unknown;
          code?: unknown;
        };
        if (result.id !== requestId) {
          await delay(80);
          continue;
        }
        if (result.ok) {
          return {
            ok: true,
            message: typeof result.message === "string" ? result.message : "ok",
            code: typeof result.code === "number" ? result.code : 0,
          };
        }
        throw new Error(typeof result.message === "string" ? result.message : "Mobile Codex Input helper failed");
      } catch (error) {
        if (error instanceof SyntaxError) {
          await delay(80);
          continue;
        }
        throw error;
      }
    }
    await delay(80);
  }
  throw new Error("Timed out waiting for Mobile Codex Input helper");
}

async function stopHelperProcesses(): Promise<void> {
  await runCommandBestEffort("pkill", ["-TERM", "-f", helperExec], 1_000);
  await delay(120);
}

async function resumeHelperProcesses(): Promise<void> {
  await runCommandBestEffort("pkill", ["-CONT", "-f", helperExec], 1_000);
}

async function runCommandBestEffort(command: string, args: string[], timeoutMs: number): Promise<void> {
  await runCommand(command, args, timeoutMs, `${command} timed out`).catch(() => undefined);
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
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
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
