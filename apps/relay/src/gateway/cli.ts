import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { z } from "zod";
import { defaultGatewayConfigPath, gatewayError, initializeGateway, pairingEndpoint, readManagedConfig, type ManagedConfig } from "./config.js";
import { startManagedGateway } from "./managedGateway.js";
import { MacGatewayService } from "./macService.js";

const statusSchema = z.object({ gateway: z.object({
  kind: z.literal("mobile-codex-gateway"), version: z.literal(1), instanceId: z.string().uuid(),
  tunnel: z.object({ enabled: z.boolean(), state: z.enum(["connecting", "connected", "reconnecting", "stopped"]) }),
}).passthrough() });
type Status = z.infer<typeof statusSchema>["gateway"];

function parseArgs(args: string[]) {
  let command = args[0] ?? "help", optionStart = 1;
  if (command === "service") {
    if (!["install", "status", "uninstall"].includes(args[1])) throw gatewayError("GATEWAY_USAGE");
    command = `service-${args[1]}`; optionStart = 2;
  }
  const allowed: Record<string, string[]> = {
    init: ["config", "workspace", "codex-home", "port", "import-legacy"], start: ["config"], status: ["config"], stop: ["config"],
    pair: ["config"], devices: ["config"], revoke: ["config", "device"], daemon: ["config"], help: [],
    "service-install": ["config"], "service-status": ["config"], "service-uninstall": ["config"],
  };
  if (!allowed[command]) throw gatewayError("GATEWAY_USAGE");
  const options: Record<string, string> = {};
  for (let i = optionStart; i < args.length; i += 2) {
    const key = args[i].replace(/^--/u, ""), value = args[i + 1];
    if (!args[i].startsWith("--") || !allowed[command].includes(key) || !value || value.startsWith("--") || key in options) throw gatewayError("GATEWAY_USAGE");
    options[key] = value;
  }
  return { command, options, file: path.resolve(options.config ?? defaultGatewayConfigPath()) };
}

type LocalRequest = { method?: "GET" | "POST" | "DELETE"; body?: string; headers?: Record<string, string> };
type LocalResponse = { status: number; ok: boolean; json: () => unknown };
function localRequest(config: ManagedConfig, route: string, init: LocalRequest = {}): Promise<LocalResponse> {
  return new Promise((resolve, reject) => {
    // Management calls are sparse. A fresh socket avoids stale pooled connections
    // after stop and needs no retry, including for non-idempotent operations.
    const request = http.request(`http://127.0.0.1:${config.port}${route}`, {
      method: init.method ?? "GET", agent: false, signal: AbortSignal.timeout(1500),
      headers: { authorization: `Bearer ${config.token}`, ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
    }, response => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("error", reject);
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 65536) { request.destroy(gatewayError("GATEWAY_RESPONSE_TOO_LARGE")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ status, ok: status >= 200 && status < 300, json: () => JSON.parse(body) });
      });
    });
    request.on("error", reject);
    request.end(init.body);
  });
}

export async function inspectGateway(config: ManagedConfig): Promise<Status | null> {
  let response: LocalResponse;
  try { response = await localRequest(config, "/api/gateway"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") return null;
    throw gatewayError("GATEWAY_PORT_UNVERIFIED");
  }
  if (!response.ok) throw gatewayError("GATEWAY_PORT_OCCUPIED");
  try { return statusSchema.parse(response.json()).gateway; }
  catch { throw gatewayError("GATEWAY_PORT_OCCUPIED"); }
}

async function api(config: ManagedConfig, route: string, init?: LocalRequest) {
  let response: LocalResponse;
  try { response = await localRequest(config, route, init); }
  catch { throw gatewayError("GATEWAY_REQUEST_UNCERTAIN"); }
  if (!response.ok) throw gatewayError(response.status === 409 ? "GATEWAY_INSTANCE_CHANGED" : "GATEWAY_REQUEST_FAILED");
  try { return response.json(); } catch { throw gatewayError("GATEWAY_REQUEST_UNCERTAIN"); }
}

export async function runGatewayCli(args: string[], entryFile: string, services: { macService?: MacGatewayService } = {}): Promise<unknown> {
  const { command, options, file } = parseArgs(args);
  if (command === "help") return { commands: ["init --workspace <absolute-path> [--codex-home <path>] [--port <port>] [--import-legacy <file>]", "start", "status", "stop", "pair", "devices", "revoke --device <id>", "service install|status|uninstall (macOS)"], configOption: "--config <file>", runtime: "Node.js >= 20", note: "插件加载不会启动网关。pair仅生成一次性配对信息。service install须显式启用。" };
  if (command === "init") {
    if (!options.workspace || !path.isAbsolute(options.workspace)) throw gatewayError("GATEWAY_WORKSPACE_REQUIRED");
    await initializeGateway(file, {
      workspace: options.workspace, codexHome: path.resolve(options["codex-home"] ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex")),
      ...(options.port ? { port: Number(options.port) } : {}), ...(options["import-legacy"] ? { importLegacy: path.resolve(options["import-legacy"]) } : {}),
    });
    return { initialized: true, configFile: file, desktopTransport: "native", note: "仅创建配置；原生同会话控制待实测。未启动或替换旧服务。" };
  }
  const serviceManager = services.macService ?? new MacGatewayService();
  if (command === "service-status") return serviceManager.status(file);
  if (command === "service-uninstall") return serviceManager.uninstall(file);
  const config = await readManagedConfig(file);
  if (command === "service-install") {
    if (await inspectGateway(config)) throw gatewayError("GATEWAY_SERVICE_GATEWAY_RUNNING");
    const service = await serviceManager.install(file, config, entryFile);
    try { return { service, running: true, gateway: await waitForGateway(config) }; }
    catch (error) {
      if ((error as { code?: string }).code === "GATEWAY_START_FAILED") throw gatewayError("GATEWAY_SERVICE_NOT_READY");
      throw error;
    }
  }
  if (command === "daemon") {
    let service: Awaited<ReturnType<typeof startManagedGateway>> | undefined;
    let signaled = false;
    const stop = () => { signaled = true; void service?.stop().catch(() => { process.exitCode = 1; console.error('{"error":"GATEWAY_STOP_FAILED"}'); }); };
    process.on("SIGTERM", stop); process.on("SIGINT", stop);
    try {
      service = await startManagedGateway(config);
      if (signaled) await service.stop();
      await service.done;
    } finally { process.off("SIGTERM", stop); process.off("SIGINT", stop); }
    return { stopped: true };
  }
  const status = await inspectGateway(config);
  if (command === "status") return { running: Boolean(status), gateway: status };
  if (command === "start") {
    if (status) return { running: true, alreadyRunning: true, gateway: status };
    if (await serviceManager.registered(file)) {
      await serviceManager.start(file);
      try { return { running: true, alreadyRunning: false, managedBy: "launchd", gateway: await waitForGateway(config) }; }
      catch (error) {
        if ((error as { code?: string }).code === "GATEWAY_START_FAILED") throw gatewayError("GATEWAY_SERVICE_NOT_READY");
        throw error;
      }
    }
    const logFile = path.join(path.dirname(file), "gateway.log");
    const stat = await fs.stat(logFile).catch(() => null);
    if (stat && stat.size > 1024 * 1024) await fs.rename(logFile, `${logFile}.previous`).catch(() => {});
    const log = await fs.open(logFile, "a", 0o600);
    let spawnFailed = false;
    try {
      const child = spawn(process.execPath, [entryFile, "daemon", "--config", file], { detached: true, stdio: ["ignore", log.fd, log.fd], cwd: config.workspace });
      child.on("error", () => { spawnFailed = true; });
      child.unref();
    } finally { await log.close(); }
    return { running: true, alreadyRunning: false, gateway: await waitForGateway(config, () => spawnFailed) };
  }
  if (!status) throw gatewayError("GATEWAY_NOT_RUNNING");
  switch (command) {
    case "stop": {
      await api(config, "/api/gateway/stop", { method: "POST", headers: { "x-mobile-codex-manager-key": config.managerKey }, body: JSON.stringify({ instanceId: status.instanceId }) });
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        let current: Status | null;
        try { current = await inspectGateway(config); }
        catch (error) {
          if ((error as { code?: string }).code !== "GATEWAY_PORT_UNVERIFIED") throw error;
          await pause(50); continue;
        }
        if (!current || current.instanceId !== status.instanceId) return { stopped: true, instanceId: status.instanceId };
        await pause(50);
      }
      throw gatewayError("GATEWAY_STOP_UNCONFIRMED");
    }
    case "pair": {
      if (!status.tunnel.enabled) throw gatewayError("GATEWAY_REMOTE_NOT_CONFIGURED");
      if (status.tunnel.state !== "connected") throw gatewayError("GATEWAY_REMOTE_OFFLINE");
      const pairing = await api(config, "/api/pairing", { method: "POST" }) as { code: string; expiresAt: string };
      return { endpoint: pairingEndpoint(config), ...pairing };
    }
    case "devices": return api(config, "/api/devices");
    case "revoke": {
      const device = z.string().uuid().safeParse(options.device);
      if (!device.success) throw gatewayError("GATEWAY_DEVICE_REQUIRED");
      return api(config, `/api/devices/${device.data}`, { method: "DELETE" });
    }
    default: throw gatewayError("GATEWAY_USAGE");
  }
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForGateway(config: ManagedConfig, spawnFailed = () => false): Promise<Status> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !spawnFailed()) {
    let current: Status | null;
    try { current = await inspectGateway(config); }
    catch (error) {
      if ((error as { code?: string }).code !== "GATEWAY_PORT_UNVERIFIED") throw error;
      await pause(50); continue;
    }
    if (current) return current;
    await pause(50);
  }
  throw gatewayError("GATEWAY_START_FAILED");
}

export function gatewayErrorMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    GATEWAY_NOT_INITIALIZED: "请先运行 init。", GATEWAY_ALREADY_INITIALIZED: "配置已存在，未覆盖。",
    GATEWAY_CONFIG_PERMISSIONS: "配置必须为私有文件（0600）且不超过64KiB。", GATEWAY_CONFIG_INVALID: "配置格式无效，请检查本地文件。",
    GATEWAY_URL_INVALID: "公网地址必须使用TLS，不能包含用户信息、查询参数或片段。", GATEWAY_IMPORT_INVALID: "旧配置无法导入。",
    GATEWAY_WORKSPACE_REQUIRED: "init必须指定 --workspace 的绝对路径，以保留设备凭证位置。",
    GATEWAY_PORT_OCCUPIED: "端口属于旧Relay或其他进程；请先安排迁移或修改新配置的端口。", GATEWAY_PORT_UNVERIFIED: "无法核验当前端口状态，请稍后查看status。",
    GATEWAY_NOT_RUNNING: "网关未运行，请先start。", GATEWAY_REMOTE_NOT_CONFIGURED: "未配置公网隧道，请先导入或填写本地配置。",
    GATEWAY_REMOTE_OFFLINE: "公网隧道尚未连接，稍后查看status。", GATEWAY_DEVICE_REQUIRED: "revoke必须指定 --device 的设备UUID。",
    GATEWAY_REQUEST_UNCERTAIN: "请求结果未知，请检查状态；不会自动重发。", GATEWAY_START_FAILED: "网关未能启动，请检查本地gateway.log。",
    GATEWAY_STOP_UNCONFIRMED: "尚未确认网关退出，请重新查看status。", GATEWAY_INSTANCE_CHANGED: "网关实例已改变，请重新查看status。",
    GATEWAY_SERVICE_UNSUPPORTED: "后台托管仅支持macOS已登录的普通用户会话。",
    GATEWAY_SERVICE_CONFLICT: "后台托管记录与当前服务不一致，已停止操作；请核对service status和本机登录项。",
    GATEWAY_SERVICE_FILES_INVALID: "后台托管文件或固定程序校验失败，已停止操作。",
    GATEWAY_SERVICE_CONFIG_MISMATCH: "此电脑已为另一配置注册后台网关，请使用原配置管理或卸载。",
    GATEWAY_SERVICE_BUSY: "另一后台托管操作尚未结束，请核对后重试。",
    GATEWAY_SERVICE_STATUS_UNKNOWN: "无法核验launchd状态，不会按未安装处理。",
    GATEWAY_SERVICE_REQUEST_UNKNOWN: "launchctl结果未知，请查看service status后再操作。",
    GATEWAY_SERVICE_ACTIVATION_FAILED: "后台托管尚未确认启动，已保留注册记录；请查看service status。",
    GATEWAY_SERVICE_STOP_UNCONFIRMED: "尚未确认后台托管退出，注册文件已保留。",
    GATEWAY_SERVICE_ALREADY_INSTALLED: "后台托管已安装；使用start启动，更新程序前先显式卸载。",
    GATEWAY_LEGACY_AUTOSTART_PRESENT: "旧Relay App登录项仍存在，请先安排停用旧登录项，避免两套服务争用端口。",
    GATEWAY_SERVICE_BUNDLE_REQUIRED: "请使用已构建插件的独立gateway.mjs安装后台托管。",
    GATEWAY_SERVICE_RUNTIME_MISSING: "托管使用的Node路径已不可执行，请卸载后用当前Node重新安装托管。",
    GATEWAY_SERVICE_NOT_INSTALLED: "后台托管尚未安装。",
    GATEWAY_SERVICE_GATEWAY_RUNNING: "网关仍在运行；请先显式stop，再安装后台托管。",
    GATEWAY_SERVICE_NOT_READY: "后台服务已注册，但网关尚未就绪；请查看service status及launchctl状态。",
    GATEWAY_USAGE: "参数无效，请运行help。",
  };
  const safeCode = code && code.startsWith("GATEWAY_") ? code : "GATEWAY_FAILED";
  return { error: safeCode, message: messages[safeCode] ?? "操作失败，请检查本地配置和运行状态。" };
}
