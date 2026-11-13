import os from "node:os";
import path from "node:path";
import { openCodeConfigSchema, type OpenCodeConfig } from "./agents/openCodeClient.js";
import { claudeConfigSchema, type ClaudeConfig } from "./agents/claudeProtocol.js";
import { deepSeekConfigSchema, type DeepSeekConfig } from "./agents/deepSeekProtocol.js";

export type RelayConfig = {
  host: string;
  port: number;
  token: string;
  codexHome: string;
  defaultCwd: string;
  desktopTransport?: "legacy" | "native";
  opencode?: OpenCodeConfig;
  claude?: ClaudeConfig;
  deepseek?: DeepSeekConfig;
};

export function loadConfig(): RelayConfig {
  const home = os.homedir();
  const host = process.env.MOBILE_CODEX_HOST ?? "127.0.0.1";
  const configuredToken = process.env.MOBILE_CODEX_TOKEN?.trim();
  const desktopTransport = process.env.MOBILE_CODEX_DESKTOP_TRANSPORT ?? (process.platform === "darwin" ? "legacy" : "native");
  const opencodeUrl = process.env.MOBILE_CODEX_OPENCODE_URL;
  const opencode = opencodeUrl ? openCodeConfigSchema.safeParse({
    url: opencodeUrl, directory: process.env.MOBILE_CODEX_OPENCODE_DIRECTORY,
    username: process.env.MOBILE_CODEX_OPENCODE_USERNAME, password: process.env.MOBILE_CODEX_OPENCODE_PASSWORD,
  }) : null;
  if (opencode && !opencode.success) throw new Error("OPENCODE_CONFIG_INVALID");
  const claudeToken = process.env.MOBILE_CODEX_CLAUDE_BRIDGE_TOKEN;
  const claude = claudeToken ? claudeConfigSchema.safeParse({ bridgeToken: claudeToken }) : null;
  if (claude && !claude.success) throw new Error("CLAUDE_CONFIG_INVALID");
  const deepSeekUrl = process.env.MOBILE_CODEX_DEEPSEEK_URL;
  const deepseek = deepSeekUrl ? deepSeekConfigSchema.safeParse({ url: deepSeekUrl, token: process.env.MOBILE_CODEX_DEEPSEEK_TOKEN, directory: process.env.MOBILE_CODEX_DEEPSEEK_DIRECTORY }) : null;
  if (deepseek && (!deepseek.success || [configuredToken || "dev-local-token", claudeToken].includes(deepseek.data.token))) throw new Error("DEEPSEEK_CONFIG_INVALID");
  if (desktopTransport !== "legacy" && desktopTransport !== "native") throw new Error("MOBILE_CODEX_DESKTOP_TRANSPORT must be legacy or native.");
  if (!configuredToken && !isLoopbackHost(host)) {
    throw new Error("MOBILE_CODEX_TOKEN is required when Relay listens on a non-loopback address.");
  }
  return {
    host,
    port: Number(process.env.MOBILE_CODEX_PORT ?? 8787),
    token: configuredToken || "dev-local-token",
    codexHome: process.env.CODEX_HOME ?? path.join(home, ".codex"),
    defaultCwd: process.env.MOBILE_CODEX_DEFAULT_CWD ?? process.cwd(),
    desktopTransport,
    ...(opencode?.success ? { opencode: opencode.data } : {}),
    ...(claude?.success ? { claude: claude.data } : {}),
    ...(deepseek?.success ? { deepseek: deepseek.data } : {}),
  };
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}
