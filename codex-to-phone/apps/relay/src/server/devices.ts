import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const deviceSchema = z.object({ id: z.string().uuid(), name: z.string().max(80), tokenHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string() });
type Device = z.infer<typeof deviceSchema>;
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** Only device hashes persist. One-time codes are bounded and expire on restart. */
export class DeviceRegistry {
  private devices: Device[] = [];
  private readonly codes = new Map<string, number>();
  private failures = 0;
  private retryAt = 0;
  private writes: Promise<unknown> = Promise.resolve();

  private constructor(private readonly file: string) {}

  static async open(file: string) {
    const registry = new DeviceRegistry(file);
    try { registry.devices = z.array(deviceSchema).max(16).parse(JSON.parse(await fs.readFile(file, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Device credentials could not be loaded; refusing to overwrite them"); }
    return registry;
  }

  authenticate(token: string): string | null {
    const actual = Buffer.from(digest(token), "hex");
    return this.devices.find(device => timingSafeEqual(Buffer.from(device.tokenHash, "hex"), actual))?.id ?? null;
  }

  has(id: string) { return id === "admin" || this.devices.some(device => device.id === id); }
  list() { return this.devices.map(({ tokenHash: _hash, ...device }) => device); }

  createPairing() {
    const now = Date.now();
    for (const [code, expiresAt] of this.codes) if (expiresAt <= now) this.codes.delete(code);
    if (this.codes.size >= 8 || this.devices.length >= 16) throw Object.assign(new Error("Pairing limit reached; revoke an unused device"), { statusCode: 429 });
    const code = randomBytes(12).toString("base64url");
    const expiresAt = now + 5 * 60_000;
    this.codes.set(digest(code), expiresAt);
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  async pair(code: string, name: string) {
    return this.serialize(async () => {
      const now = Date.now();
      if (now < this.retryAt) throw Object.assign(new Error("Try pairing again later"), { statusCode: 429 });
      const hash = digest(code);
      const expiresAt = this.codes.get(hash);
      if (!expiresAt || expiresAt <= now) {
        if (++this.failures >= 10) { this.retryAt = now + 60_000; this.failures = 0; }
        throw Object.assign(new Error("Pairing code is invalid or expired"), { statusCode: 401 });
      }
      this.codes.delete(hash); // Consume before IO; uncertain results require a fresh code.
      if (this.devices.length >= 16) throw Object.assign(new Error("Device limit reached"), { statusCode: 429 });
      const token = randomBytes(32).toString("base64url");
      const device = { id: randomUUID(), name, createdAt: new Date(now).toISOString(), tokenHash: digest(token) };
      const next = [...this.devices, device];
      await this.persist(next);
      this.devices = next;
      this.failures = 0;
      return { device: { id: device.id, name, createdAt: device.createdAt }, token };
    });
  }

  async revoke(id: string) {
    return this.serialize(async () => {
      const next = this.devices.filter(device => device.id !== id);
      await this.persist(next);
      this.devices = next;
    });
  }

  private async persist(devices: Device[]) {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(devices), { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, this.file);
    } finally { await fs.rm(temporary, { force: true }); }
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.writes.then(action, action);
    this.writes = pending.catch(() => undefined);
    return pending;
  }
}
