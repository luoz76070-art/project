import os from "node:os";
import path from "node:path";

export type RelayConfig = {
  host: string;
  port: number;
  token: string;
  codexHome: string;
  defaultCwd: string;
};

export function loadConfig(): RelayConfig {
  const home = os.homedir();
  const host = process.env.MOBILE_CODEX_HOST ?? "127.0.0.1";
  const configuredToken = process.env.MOBILE_CODEX_TOKEN?.trim();
  if (!configuredToken && !isLoopbackHost(host)) {
    throw new Error("MOBILE_CODEX_TOKEN is required when Relay listens on a non-loopback address.");
  }
  return {
    host,
    port: Number(process.env.MOBILE_CODEX_PORT ?? 8787),
    token: configuredToken || "dev-local-token",
    codexHome: process.env.CODEX_HOME ?? path.join(home, ".codex"),
    defaultCwd: process.env.MOBILE_CODEX_DEFAULT_CWD ?? process.cwd(),
  };
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}
