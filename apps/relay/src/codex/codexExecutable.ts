import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodexExecutableResolution = {
  executable: string | null;
  source: "configured" | "path" | "known-location" | "desktop-app" | "not-found";
  searched: string[];
};

export type CodexExecutableOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
};

export function resolveCodexExecutable(options: CodexExecutableOptions = {}): string {
  return resolveCodexExecutableDetails(options).executable ?? "codex";
}

export function resolveCodexExecutableDetails(options: CodexExecutableOptions = {}): CodexExecutableResolution {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const searched: string[] = [];

  const configured = [env.MOBILE_CODEX_EXECUTABLE, env.MOBILE_CODEX_CODEX_EXE, env.CODEX_EXECUTABLE]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  for (const candidate of configured) {
    searched.push(candidate);
    if (isExecutable(candidate, platform)) {
      return { executable: candidate, source: "configured", searched };
    }
  }

  const pathCandidates = pathEntries(env.PATH, platform).flatMap((directory) => [
    path.join(directory, platform === "win32" ? "codex.cmd" : "codex"),
    path.join(directory, platform === "win32" ? "codex.exe" : "codex.js"),
  ]);
  for (const candidate of pathCandidates) {
    searched.push(candidate);
    if (isExecutable(candidate, platform)) {
      return { executable: candidate, source: "path", searched };
    }
  }

  const knownLocations = knownCodexLocations(homeDir, platform);
  for (const candidate of knownLocations) {
    searched.push(candidate);
    if (isExecutable(candidate, platform)) {
      return { executable: candidate, source: "known-location", searched };
    }
  }

  const desktop = findDesktopCodexExecutable(platform);
  if (desktop) {
    searched.push(desktop);
    return { executable: desktop, source: "desktop-app", searched };
  }

  return { executable: null, source: "not-found", searched };
}

export function requireCodexExecutable(options: CodexExecutableOptions = {}): string {
  const result = resolveCodexExecutableDetails(options);
  if (result.executable) return result.executable;

  const env = options.env ?? process.env;
  const searched = result.searched.slice(-12).join(", ");
  throw new Error(
    [
      "Codex executable was not found.",
      "Set MOBILE_CODEX_EXECUTABLE to the absolute path of the Codex CLI, then restart Mobile Codex Relay.",
      `PATH=${env.PATH ?? "(empty)"}`,
      searched ? `Checked: ${searched}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function knownCodexLocations(homeDir: string, platform: NodeJS.Platform): string[] {
  if (platform === "darwin") {
    return [
      path.join(homeDir, ".npm-global", "bin", "codex"),
      path.join(homeDir, ".local", "bin", "codex"),
      path.join(homeDir, ".local", "node", "bin", "codex"),
      path.join(homeDir, ".local", "node-v22.22.1-darwin-arm64", "bin", "codex"),
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      "/Applications/Codex.app/Contents/Resources/codex",
    ];
  }

  if (platform === "win32") {
    return [
      path.join(homeDir, "AppData", "Roaming", "npm", "codex.cmd"),
      "C:\\Program Files\\nodejs\\codex.cmd",
    ];
  }

  return [
    path.join(homeDir, ".npm-global", "bin", "codex"),
    path.join(homeDir, ".local", "bin", "codex"),
    "/usr/local/bin/codex",
    "/usr/bin/codex",
  ];
}

function findDesktopCodexExecutable(platform: NodeJS.Platform): string | null {
  if (platform === "darwin") {
    const roots = ["/Applications", path.join(os.homedir(), "Applications")];
    const candidates: string[] = [];
    for (const root of roots) {
      for (const appName of listDirectories(root)) {
        if (!/^(Codex|ChatGPT)(\.app|[-.])/u.test(appName)) continue;
        const bundle = path.join(root, appName, "Contents", "Resources");
        candidates.push(
          path.join(bundle, "codex"),
          path.join(bundle, "app", "bin", "codex"),
          path.join(bundle, "app", "node_modules", "@openai", "codex", "bin", "codex.js"),
        );
      }
    }
    return candidates.find((candidate) => isExecutable(candidate, platform)) ?? null;
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

function pathEntries(value: string | undefined, platform: NodeJS.Platform): string[] {
  const separator = platform === "win32" ? ";" : ":";
  return (value ?? "")
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function listDirectories(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isExecutable(candidate: string, platform: NodeJS.Platform): boolean {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    return platform === "win32" || Boolean(stat.mode & 0o111);
  } catch {
    return false;
  }
}
