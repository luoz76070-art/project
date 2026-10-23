import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { openCodeConfigSchema } from "../agents/openCodeClient.js";
import { claudeConfigSchema } from "../agents/claudeProtocol.js";
import { deepSeekConfigSchema } from "../agents/deepSeekProtocol.js";

const absolutePath = z.string().refine(value => path.isAbsolute(value));
const secret = z.string().min(32).max(512);
const brokerSchema = z.object({ brokerUrl: z.string(), relayId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), relaySecret: secret }).strict();
const schema = z.object({
  version: z.literal(1), port: z.number().int().min(1).max(65535), token: secret, managerKey: secret,
  codexHome: absolutePath, workspace: absolutePath, desktopTransport: z.literal("native"),
  tunnel: brokerSchema.optional(), publicEndpoint: z.string().optional(),
  opencode: openCodeConfigSchema.optional(),
  claude: claudeConfigSchema.optional(),
  deepseek: deepSeekConfigSchema.optional(),
}).strict();
export type ManagedConfig = z.infer<typeof schema>;

export function gatewayError(code: string): Error & { code: string } { return Object.assign(new Error(code), { code }); }

export function defaultGatewayConfigPath() {
  const directory = process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "Mobile Codex Gateway")
    : path.join(os.homedir(), ".local", "share", "mobile-codex-gateway");
  return path.join(directory, "gateway.json");
}

/** One boundary for CLI, daemon and file imports; never include input values in errors. */
export function parseManagedConfig(input: unknown): ManagedConfig {
  const result = schema.safeParse(input);
  if (!result.success) throw gatewayError("GATEWAY_CONFIG_INVALID");
  const config = result.data;
  if (config.claude && [config.token, config.managerKey].includes(config.claude.bridgeToken)) throw gatewayError("GATEWAY_CONFIG_INVALID");
  if (config.deepseek && [config.token, config.managerKey, config.claude?.bridgeToken].includes(config.deepseek.token)) throw gatewayError("GATEWAY_CONFIG_INVALID");
  if (config.tunnel) validateUrl(config.tunnel.brokerUrl, true);
  if (config.publicEndpoint) validateUrl(config.publicEndpoint, false);
  return config;
}

function validateUrl(raw: string, broker: boolean) {
  try {
    const url = new URL(raw);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const secure = broker ? ["https:", "wss:"] : ["https:"];
    const local = broker ? ["http:", "ws:"] : ["http:"];
    if (url.username || url.password || url.search || url.hash || (!secure.includes(url.protocol) && !(loopback && local.includes(url.protocol)))) throw new Error();
  } catch { throw gatewayError("GATEWAY_URL_INVALID"); }
}

export async function readManagedConfig(file: string): Promise<ManagedConfig> {
  try {
    const stat = await fs.stat(file);
    if (stat.size > 65536 || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) throw gatewayError("GATEWAY_CONFIG_PERMISSIONS");
    return parseManagedConfig(JSON.parse(await fs.readFile(file, "utf8")));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code?.startsWith("GATEWAY_")) throw error;
    throw gatewayError(code === "ENOENT" ? "GATEWAY_NOT_INITIALIZED" : "GATEWAY_CONFIG_INVALID");
  }
}

export async function initializeGateway(file: string, options: { workspace: string; codexHome: string; port?: number; importLegacy?: string }): Promise<void> {
  let legacy: { port?: number; token?: string; brokerUrl?: string; relayId?: string; relaySecret?: string } = {};
  if (options.importLegacy) {
    try { legacy = JSON.parse(await fs.readFile(options.importLegacy, "utf8")); }
    catch { throw gatewayError("GATEWAY_IMPORT_INVALID"); }
    if (!legacy || typeof legacy !== "object" || !legacy.token || !legacy.port) throw gatewayError("GATEWAY_IMPORT_INVALID");
  }
  const hasTunnel = legacy.brokerUrl || legacy.relayId || legacy.relaySecret;
  const config = parseManagedConfig({
    version: 1, workspace: options.workspace, codexHome: options.codexHome, port: options.port ?? legacy.port ?? 8787,
    token: legacy.token ?? randomBytes(32).toString("base64url"), managerKey: randomBytes(32).toString("base64url"), desktopTransport: "native",
    ...(hasTunnel ? { tunnel: { brokerUrl: legacy.brokerUrl, relayId: legacy.relayId, relaySecret: legacy.relaySecret } } : {}),
  });
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await fs.link(temporary, file); // Atomic create-if-absent, including concurrent init.
  } catch (error) {
    throw gatewayError((error as NodeJS.ErrnoException).code === "EEXIST" ? "GATEWAY_ALREADY_INITIALIZED" : "GATEWAY_CONFIG_WRITE_FAILED");
  } finally { await fs.rm(temporary, { force: true }); }
}

export function pairingEndpoint(config: ManagedConfig): string {
  if (config.publicEndpoint) return config.publicEndpoint.replace(/\/+$/u, "");
  if (!config.tunnel) return `http://127.0.0.1:${config.port}`;
  const url = new URL(config.tunnel.brokerUrl);
  url.protocol = ["wss:", "https:"].includes(url.protocol) ? "https:" : "http:";
  url.pathname = `${url.pathname.replace(/\/relay\/connect\/?$/u, "").replace(/\/+$/u, "")}/r/${encodeURIComponent(config.tunnel.relayId)}`;
  return url.toString().replace(/\/+$/u, "");
}
