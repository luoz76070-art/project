import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveCodexExecutable(): string {
  const configured = process.env.MOBILE_CODEX_CODEX_EXE;
  if (configured && fs.existsSync(configured)) return configured;

  const desktop = findDesktopCodexExecutable();
  if (desktop) return desktop;

  const npmCmd = path.join(os.homedir(), "AppData", "Roaming", "npm", "codex.cmd");
  if (fs.existsSync(npmCmd)) return npmCmd;

  return "codex";
}

function findDesktopCodexExecutable(): string | null {
  if (process.platform === "darwin") {
    const appBundleCodex = "/Applications/Codex.app/Contents/Resources/codex";
    return fs.existsSync(appBundleCodex) ? appBundleCodex : null;
  }

  const windowsApps = "C:\\Program Files\\WindowsApps";
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(windowsApps, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("OpenAI.Codex_"))
    .map((entry) => {
      const root = path.join(windowsApps, entry.name);
      const exe = path.join(root, "app", "resources", "codex.exe");
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(root).mtimeMs;
      } catch {
        return null;
      }
      return fs.existsSync(exe) ? { exe, mtimeMs } : null;
    })
    .filter((candidate): candidate is { exe: string; mtimeMs: number } => Boolean(candidate))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.exe ?? null;
}
