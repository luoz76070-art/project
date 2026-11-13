import { promises as fs, constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const key = z.string().trim().min(8).max(512).regex(/^[\x21-\x7e]+$/);
const region = z.enum(["cn", "sg"]);
const workspace = z.string().trim().max(100).regex(/^[a-zA-Z0-9_-]*$/);
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const baseUrl = z.string().trim().min(1).max(1024).transform((value, context) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || /[\s\\]/u.test(value)) throw new Error();
    const base = url.pathname.replace(/\/+$/u, "").replace(/\/chat\/completions$/u, "");
    return `${url.origin}${base}`;
  } catch { context.addIssue({ code: "custom", message: "invalid HTTPS API base URL" }); return z.NEVER; }
});
export const DEFAULT_QWEN_MODEL = "qwen-audio-3.1-asr-flash";
export const qwenModel = z.enum([DEFAULT_QWEN_MODEL, "qwen3-asr-flash"]);
export function defaultQwenBaseUrl(region: "cn" | "sg") {
  return `https://${region === "sg" ? "dashscope-intl.aliyuncs.com" : "dashscope.aliyuncs.com"}/compatible-mode/v1`;
}
const qwenBaseUrl = baseUrl.transform((value, context) => {
  const url = new URL(value);
  if (!["", "/", "/compatible-mode/v1", "/api/v1", "/api/v1/services/aigc/multimodal-generation/generation"].includes(url.pathname)) {
    context.addIssue({ code: "custom", message: "invalid Qwen API path" }); return z.NEVER;
  }
  return `${url.origin}/compatible-mode/v1`;
});
const model = z.string().trim().min(1).max(200).regex(/^[\x21-\x7e]+$/);
const credentialsSchema = z.object({ region, workspace, qwenKey: key.optional(), qwenBaseUrl: qwenBaseUrl.optional(), qwenModel: qwenModel.optional(), deepseekKey: key.optional(), deepseekBaseUrl: baseUrl.optional(), deepseekModel: model.optional() }).strict();
export const voiceConfigPatch = z.object({ region: region.optional(), workspace: workspace.optional(), qwenKey: key.nullable().optional(), qwenBaseUrl: qwenBaseUrl.optional(), qwenModel: qwenModel.optional(), deepseekKey: key.nullable().optional(), deepseekBaseUrl: baseUrl.optional(), deepseekModel: model.optional() }).strict();
export type VoiceCredentials = z.infer<typeof credentialsSchema>;

/** Dedicated private file; never included in gateway status or mobile caches. */
export class VoiceCredentialStore {
  private records: Record<string, VoiceCredentials> = Object.create(null);
  private writes: Promise<unknown> = Promise.resolve();
  private constructor(private readonly file: string) {}

  static async open(file: string) {
    const store = new VoiceCredentialStore(file);
    try {
      const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 65_536 || (process.platform !== "win32" && (stat.mode & 0o077))) throw new Error("private_file_required");
        store.records = z.record(z.string().regex(/^(admin|[0-9a-f-]{36})$/), credentialsSchema).parse(JSON.parse(await handle.readFile("utf8")));
      } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("VOICE_CREDENTIALS_UNAVAILABLE");
    }
    return store;
  }

  get(owner: string): VoiceCredentials { return this.records[owner] ?? { region: "cn", workspace: "" }; }
  status(owner: string) {
    const config = this.get(owner);
    return { region: config.region, workspace: config.workspace, qwenConfigured: Boolean(config.qwenKey), deepseekConfigured: Boolean(config.deepseekKey), deepseekBaseUrl: config.deepseekBaseUrl ?? DEFAULT_DEEPSEEK_BASE_URL, qwenBaseUrl: config.qwenBaseUrl ?? defaultQwenBaseUrl(config.region), asrModel: config.qwenModel ?? DEFAULT_QWEN_MODEL, promptModel: config.deepseekModel ?? DEFAULT_DEEPSEEK_MODEL };
  }

  update(owner: string, patch: z.infer<typeof voiceConfigPatch>, valid: () => boolean) {
    return this.serialize(async () => {
      if (!valid()) throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
      const next = { ...this.get(owner) };
      // Never forward an already saved credential to a newly chosen destination.
      if (patch.deepseekBaseUrl !== undefined && patch.deepseekBaseUrl !== (next.deepseekBaseUrl ?? DEFAULT_DEEPSEEK_BASE_URL) && next.deepseekKey && patch.deepseekKey === undefined) {
        throw Object.assign(new Error("voice_deepseek_key_required_for_url"), { statusCode: 409 });
      }
      const qwenTarget = patch.qwenBaseUrl ?? next.qwenBaseUrl ?? defaultQwenBaseUrl(patch.region ?? next.region);
      if (qwenTarget !== (next.qwenBaseUrl ?? defaultQwenBaseUrl(next.region)) && next.qwenKey && patch.qwenKey === undefined) {
        throw Object.assign(new Error("voice_qwen_key_required_for_url"), { statusCode: 409 });
      }
      if (patch.qwenBaseUrl !== undefined) next.qwenBaseUrl = patch.qwenBaseUrl;
      if (patch.qwenModel !== undefined) next.qwenModel = patch.qwenModel;
      if (patch.deepseekBaseUrl !== undefined) next.deepseekBaseUrl = patch.deepseekBaseUrl;
      if (patch.deepseekModel !== undefined) next.deepseekModel = patch.deepseekModel;
      if (patch.region !== undefined) next.region = patch.region;
      if (patch.workspace !== undefined) next.workspace = patch.workspace;
      for (const field of ["qwenKey", "deepseekKey"] as const) {
        if (patch[field] === null) delete next[field];
        else if (patch[field] !== undefined) next[field] = patch[field];
      }
      await this.persist({ ...this.records, [owner]: next });
      return this.status(owner);
    });
  }

  remove(owner: string) {
    return this.serialize(async () => {
      if (!Object.hasOwn(this.records, owner)) return;
      const next = { ...this.records }; delete next[owner];
      await this.persist(next);
    });
  }

  private async persist(next: Record<string, VoiceCredentials>) {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(next), { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, this.file);
      this.records = next;
    } finally { await fs.rm(temporary, { force: true }); }
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.writes.then(action, action);
    this.writes = pending.catch(() => undefined);
    return pending;
  }
}
