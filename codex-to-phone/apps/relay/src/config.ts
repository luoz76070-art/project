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
  const token = process.env.MOBILE_CODEX_TOKEN ?? "dev-local-token";
  return {
    host: process.env.MOBILE_CODEX_HOST ?? "127.0.0.1",
    port: Number(process.env.MOBILE_CODEX_PORT ?? 8787),
    token,
    codexHome: process.env.CODEX_HOME ?? path.join(home, ".codex"),
    defaultCwd: process.env.MOBILE_CODEX_DEFAULT_CWD ?? process.cwd(),
  };
}
