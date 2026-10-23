import fs from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { gatewayError, type ManagedConfig } from "./config.js";

export const gatewayServiceLabel = "local.mobile-codex.gateway";
const absolute = z.string().max(4096).refine(value => path.isAbsolute(value) && !/[\u0000-\u001f]/u.test(value));
const receiptSchema = z.object({
  version: z.literal(1), label: z.literal(gatewayServiceLabel), configFile: absolute,
  nodePath: absolute, workspace: absolute, bundleSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
type Receipt = z.infer<typeof receiptSchema>;
type LaunchResult = { code: number; stdout: string; stderr: string };
export type LaunchctlRunner = (args: string[]) => Promise<LaunchResult>;
const execute = promisify(execFile);
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const xml = (value: string) => value.replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
async function exists(file: string) { try { await fs.lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }

async function nativeLaunchctl(args: string[]): Promise<LaunchResult> {
  try {
    const result = await execute("/bin/launchctl", args, { timeout: 8000, maxBuffer: 256 * 1024, env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" } });
    return { code: 0, ...result };
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string; killed?: boolean };
    if (typeof result.code !== "number" || result.killed) throw gatewayError("GATEWAY_SERVICE_REQUEST_UNKNOWN");
    return { code: result.code, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }
}

/** Explicit user LaunchAgent management. Tests inject a temporary home and launchctl runner. */
export class MacGatewayService {
  readonly root: string;
  readonly plistFile: string;
  readonly receiptFile: string;
  private readonly lockFile: string;
  private readonly platform: string;
  private readonly uid: number;
  private readonly nodePath: string;
  private readonly run: LaunchctlRunner;
  private readonly home: string;

  constructor(options: { home?: string; platform?: string; uid?: number; nodePath?: string; run?: LaunchctlRunner } = {}) {
    this.home = options.home ?? os.homedir();
    this.platform = options.platform ?? process.platform;
    this.uid = options.uid ?? process.getuid?.() ?? -1;
    this.nodePath = options.nodePath ?? process.execPath;
    this.run = options.run ?? nativeLaunchctl;
    this.root = path.join(this.home, "Library", "Application Support", "Mobile Codex Gateway", "service");
    this.plistFile = path.join(this.home, "Library", "LaunchAgents", `${gatewayServiceLabel}.plist`);
    this.receiptFile = path.join(this.root, "registration.json");
    this.lockFile = path.join(this.root, "operation.lock");
  }

  private supported() {
    if (this.platform !== "darwin" || !Number.isInteger(this.uid) || this.uid <= 0) throw gatewayError("GATEWAY_SERVICE_UNSUPPORTED");
  }
  private get domain() { return `gui/${this.uid}`; }
  private get target() { return `${this.domain}/${gatewayServiceLabel}`; }
  private bundleFile(receipt: Receipt) { return path.join(this.root, `gateway-${receipt.bundleSha256}.mjs`); }
  private plist(receipt: Receipt) {
    const strings = [receipt.nodePath, this.bundleFile(receipt), "daemon", "--config", receipt.configFile].map(value => `    <string>${xml(value)}</string>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${gatewayServiceLabel}</string>
  <key>ProgramArguments</key><array>
${strings}
  </array>
  <key>WorkingDirectory</key><string>${xml(receipt.workspace)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>${xml(this.home)}</string>
    <key>PATH</key><string>${xml(path.dirname(receipt.nodePath))}:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
`;
  }
  private async privateBytes(file: string, max: number) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > max) throw gatewayError("GATEWAY_SERVICE_FILES_INVALID");
    return fs.readFile(file);
  }
  private async record(): Promise<Receipt | null> {
    const [receiptPresent, plistPresent] = await Promise.all([exists(this.receiptFile), exists(this.plistFile)]);
    if (!receiptPresent && !plistPresent) return null;
    if (!receiptPresent || !plistPresent) throw gatewayError("GATEWAY_SERVICE_CONFLICT");
    try {
      const receipt = receiptSchema.parse(JSON.parse((await this.privateBytes(this.receiptFile, 65536)).toString("utf8")));
      if ((await this.privateBytes(this.plistFile, 65536)).toString("utf8") !== this.plist(receipt)) throw gatewayError("GATEWAY_SERVICE_CONFLICT");
      if (digest(await this.privateBytes(this.bundleFile(receipt), 4 * 1024 * 1024)) !== receipt.bundleSha256) throw gatewayError("GATEWAY_SERVICE_FILES_INVALID");
      return receipt;
    } catch (error) {
      if ((error as { code?: string }).code?.startsWith("GATEWAY_")) throw error;
      throw gatewayError("GATEWAY_SERVICE_FILES_INVALID");
    }
  }
  private match(receipt: Receipt, configFile: string) {
    if (receipt.configFile !== path.resolve(configFile)) throw gatewayError("GATEWAY_SERVICE_CONFIG_MISMATCH");
  }
  private async unlocked() { if (await exists(this.lockFile)) throw gatewayError("GATEWAY_SERVICE_BUSY"); }
  private async loaded() {
    const response = await this.run(["print", this.target]);
    if (response.code === 0) return true;
    // A timeout, permission failure or missing GUI domain is not proof of an absent job.
    if (response.code === 113 && /Could not find service /u.test(response.stderr)) return false;
    throw gatewayError("GATEWAY_SERVICE_STATUS_UNKNOWN");
  }
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    this.supported();
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    try { await fs.mkdir(this.lockFile, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw gatewayError("GATEWAY_SERVICE_BUSY"); throw error; }
    try { return await operation(); }
    finally { await fs.rmdir(this.lockFile); }
  }
  private async create(file: string, bytes: Buffer | string) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await fs.link(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
  }

  /** Normal start only consults our own files; an unrelated configuration is never adopted. */
  async registered(configFile: string) {
    if (this.platform !== "darwin" || this.uid <= 0) return false;
    this.supported(); await this.unlocked();
    const receipt = await this.record();
    return receipt !== null && receipt.configFile === path.resolve(configFile);
  }

  async status(configFile: string) {
    this.supported(); await this.unlocked();
    const receipt = await this.record();
    if (receipt) this.match(receipt, configFile);
    const loaded = await this.loaded();
    if (!receipt && loaded) throw gatewayError("GATEWAY_SERVICE_CONFLICT");
    return { installed: Boolean(receipt), loaded, label: gatewayServiceLabel, restartOnFailure: Boolean(receipt) };
  }

  async install(configFile: string, config: ManagedConfig, entryFile: string) {
    return this.locked(async () => {
      const existing = await this.record();
      if (existing) { this.match(existing, configFile); throw gatewayError("GATEWAY_SERVICE_ALREADY_INSTALLED"); }
      if (await exists(path.join(this.home, "Library", "LaunchAgents", "local.mobile-codex.relay.plist"))) throw gatewayError("GATEWAY_LEGACY_AUTOSTART_PRESENT");
      if (await this.loaded()) throw gatewayError("GATEWAY_SERVICE_CONFLICT");
      if (path.basename(entryFile) !== "gateway.mjs") throw gatewayError("GATEWAY_SERVICE_BUNDLE_REQUIRED");
      const bytes = await fs.readFile(entryFile);
      if (bytes.length > 4 * 1024 * 1024) throw gatewayError("GATEWAY_SERVICE_BUNDLE_REQUIRED");
      const receipt = receiptSchema.parse({ version: 1, label: gatewayServiceLabel, configFile: path.resolve(configFile), nodePath: this.nodePath, workspace: config.workspace, bundleSha256: digest(bytes) });
      await fs.access(receipt.nodePath, constants.X_OK);
      const bundle = this.bundleFile(receipt);
      try { await this.create(bundle, bytes); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      if (digest(await this.privateBytes(bundle, 4 * 1024 * 1024)) !== receipt.bundleSha256) throw gatewayError("GATEWAY_SERVICE_FILES_INVALID");
      await fs.mkdir(path.dirname(this.plistFile), { recursive: true, mode: 0o700 });
      let ownedReceipt = false, ownedPlist = false, activationAttempted = false;
      try {
        await this.create(this.receiptFile, JSON.stringify(receipt, null, 2) + "\n"); ownedReceipt = true;
        await this.create(this.plistFile, this.plist(receipt)); ownedPlist = true;
        activationAttempted = true;
        const response = await this.run(["bootstrap", this.domain, this.plistFile]);
        if (response.code !== 0) throw gatewayError("GATEWAY_SERVICE_ACTIVATION_FAILED");
        if (!await this.loaded()) throw gatewayError("GATEWAY_SERVICE_ACTIVATION_FAILED");
      } catch (error) {
        // A launchctl failure can have an unknown outcome. Keep the exact ownership record.
        if (!activationAttempted) {
          if (ownedPlist) await fs.rm(this.plistFile);
          if (ownedReceipt) await fs.rm(this.receiptFile);
        }
        throw error;
      }
      return { installed: true, loaded: true, label: gatewayServiceLabel, restartOnFailure: true };
    });
  }

  async start(configFile: string) {
    return this.locked(async () => {
      const receipt = await this.record();
      if (!receipt) throw gatewayError("GATEWAY_SERVICE_NOT_INSTALLED");
      this.match(receipt, configFile);
      try { await fs.access(receipt.nodePath, constants.X_OK); }
      catch { throw gatewayError("GATEWAY_SERVICE_RUNTIME_MISSING"); }
      const response = await this.run(await this.loaded() ? ["kickstart", this.target] : ["bootstrap", this.domain, this.plistFile]);
      if (response.code !== 0) throw gatewayError("GATEWAY_SERVICE_ACTIVATION_FAILED");
    });
  }

  async uninstall(configFile: string) {
    return this.locked(async () => {
      const receipt = await this.record();
      if (!receipt) {
        if (await this.loaded()) throw gatewayError("GATEWAY_SERVICE_CONFLICT");
        return { installed: false, loaded: false, removed: false };
      }
      this.match(receipt, configFile);
      if (await this.loaded()) {
        const response = await this.run(["bootout", this.target]);
        if (response.code !== 0 || await this.loaded()) throw gatewayError("GATEWAY_SERVICE_STOP_UNCONFIRMED");
      }
      // Preserve the configuration, devices, uploads and fixed program for recovery.
      await fs.rm(this.plistFile); await fs.rm(this.receiptFile);
      return { installed: false, loaded: false, removed: true };
    });
  }
}
