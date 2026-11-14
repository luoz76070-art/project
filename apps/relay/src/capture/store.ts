import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CaptureAsset } from '../../../../shared/capture.js';
import { captureError, captureLimits, sanitizeCaptureImage } from './image.js';

const uuid = z.string().uuid();
export const captureUploadSchema = z.object({ purpose: z.literal('capture'), assetId: uuid, captureId: uuid,
  role: z.enum(['original', 'preview']), originalAssetId: uuid.nullable(), fileName: z.string().min(1).max(200),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']), dataBase64: z.string().min(4).max(35 * 1024 * 1024) }).strict();
export const captureAssetSchema = z.object({ id: uuid, captureId: uuid, role: z.enum(['original', 'preview']), originalAssetId: uuid.nullable(),
  relativePath: z.string().max(512), fileName: z.string().max(200), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().positive().max(captureLimits.imageBytes), width: z.number().int().positive().max(captureLimits.edge),
  height: z.number().int().positive().max(captureLimits.edge), orientation: z.number().int().min(1).max(8),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime(), managed: z.literal(true) }).strict();
const receiptSchema = z.object({ version: z.literal(1), asset: captureAssetSchema, owner: z.string().min(1).max(128), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Receipt = z.infer<typeof receiptSchema>;
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Immutable data + receipt renamed together. A single Relay owns this workspace. */
export class CaptureAssetStore {
  private entries = new Map<string, Receipt>();
  private writes: Promise<unknown> = Promise.resolve();
  private loaded: Promise<void> | undefined;
  private readonly directory: string;
  constructor(private root: string) { this.directory = path.join(root, 'mobile-uploads', 'captures'); }
  private async load() {
    if (!this.loaded) this.loaded = (async () => {
      const uploads = path.dirname(this.directory);
      await fs.mkdir(uploads, { recursive: true, mode: 0o700 });
      if (await fs.realpath(uploads) !== path.join(await fs.realpath(this.root), 'mobile-uploads')) throw captureError('capture_store_unavailable', 503);
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (await fs.realpath(this.directory) !== path.join(await fs.realpath(this.root), 'mobile-uploads', 'captures')) throw captureError('capture_store_unavailable', 503);
      const files = await fs.readdir(this.directory, { withFileTypes: true });
      if (files.length > captureLimits.assets + 4) throw captureError('capture_store_unavailable', 503);
      for (const file of files) {
        if (!file.isDirectory() || file.isSymbolicLink()) throw captureError('capture_store_unavailable', 503);
        if (/^\.tmp-[a-f0-9-]{36}$/.test(file.name)) { await fs.rm(path.join(this.directory, file.name), { recursive: true }); continue; }
        uuid.parse(file.name);
        const receiptPath = path.join(this.directory, file.name, 'receipt.json');
        if ((await fs.lstat(receiptPath)).size > 4096 || (await fs.lstat(receiptPath)).isSymbolicLink()) throw captureError('capture_store_unavailable', 503);
        const receipt = receiptSchema.parse(JSON.parse(await fs.readFile(receiptPath, 'utf8')));
        if (receipt.asset.id !== file.name || receipt.asset.relativePath !== this.relative(file.name)) throw captureError('capture_store_unavailable', 503);
        const stat = await fs.lstat(path.join(this.directory, file.name, 'image'));
        if (!stat.isFile() || stat.size !== receipt.asset.size) throw captureError('capture_store_unavailable', 503);
        this.entries.set(file.name, receipt);
      }
    })().catch(() => { throw captureError('capture_store_unavailable', 503); });
    await this.loaded;
  }
  private relative(id: string) { return `mobile-uploads/captures/${id}/image`; }
  async get(id: string): Promise<CaptureAsset> {
    uuid.parse(id); await this.load(); const receipt = this.entries.get(id);
    if (!receipt) throw captureError('capture_asset_not_found', 404);
    return structuredClone(receipt.asset);
  }
  async read(id: string) {
    const asset = await this.get(id), file = path.join(this.root, asset.relativePath);
    if (await fs.realpath(file) !== path.join(await fs.realpath(this.root), asset.relativePath)) throw captureError('capture_store_unavailable', 503);
    const stat = await fs.stat(file); if (stat.size !== asset.size) throw captureError('capture_store_unavailable', 503);
    const data = await fs.readFile(file);
    if (hash(data) !== asset.sha256) throw captureError('capture_store_unavailable', 503);
    return { asset, data };
  }
  async validate(ids: string[], captureId: string, owner: string): Promise<CaptureAsset[]> {
    await this.load(); if (new Set(ids).size !== ids.length) throw captureError('capture_duplicate_asset', 400);
    const assets: CaptureAsset[] = [];
    for (const id of ids) {
      const asset = await this.get(id);
      if (asset.captureId !== captureId || this.entries.get(id)!.owner !== owner) throw captureError('capture_asset_forbidden', 403);
      assets.push(asset);
    }
    const originals = assets.filter(a => a.role === 'original'), previews = assets.filter(a => a.role === 'preview');
    if (originals.length > captureLimits.originals || previews.length > originals.length || assets.reduce((n, a) => n + a.size, 0) > captureLimits.cardBytes) throw captureError('capture_capacity', 413);
    if (new Set(previews.map(a => a.originalAssetId)).size !== previews.length || previews.some(a => !originals.some(o => o.id === a.originalAssetId))) throw captureError('capture_preview_invalid', 422);
    return assets;
  }
  save(raw: unknown, owner: string, guard: () => void): Promise<CaptureAsset> {
    const input = captureUploadSchema.parse(raw);
    const run = this.writes.then(async () => {
      guard(); await this.load();
      if (input.dataBase64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64)) throw captureError('capture_invalid_base64', 400);
      const bytes = Buffer.from(input.dataBase64, 'base64');
      if (bytes.toString('base64') !== input.dataBase64) throw captureError('capture_invalid_base64', 400);
      const fingerprint = hash(JSON.stringify({ ...input, dataBase64: hash(bytes), owner }));
      const existing = this.entries.get(input.assetId);
      if (existing) { if (existing.fingerprint !== fingerprint) throw captureError('capture_asset_conflict', 409); guard(); return structuredClone(existing.asset); }
      const image = sanitizeCaptureImage(bytes, input.mimeType);
      const all = [...this.entries.values()].map(e => e.asset), siblings = all.filter(a => a.captureId === input.captureId);
      if (input.role === 'original' ? input.originalAssetId !== null : !input.originalAssetId) throw captureError('capture_preview_invalid');
      if (input.role === 'preview') {
        const original = this.entries.get(input.originalAssetId!);
        if (!original || original.owner !== owner || original.asset.captureId !== input.captureId || original.asset.role !== 'original' || siblings.some(a => a.originalAssetId === input.originalAssetId)) throw captureError('capture_preview_invalid');
        if (image.width > captureLimits.previewEdge || image.height > captureLimits.previewEdge || image.orientation !== 1) throw captureError('capture_preview_invalid');
      }
      if (this.entries.size >= captureLimits.assets || all.reduce((n, a) => n + a.size, image.data.length) > captureLimits.storeBytes ||
        siblings.reduce((n, a) => n + a.size, image.data.length) > captureLimits.cardBytes || siblings.filter(a => a.role === input.role).length >= captureLimits.originals) throw captureError('capture_capacity', 507);
      const asset: CaptureAsset = { id: input.assetId, captureId: input.captureId, role: input.role, originalAssetId: input.originalAssetId,
        relativePath: this.relative(input.assetId), fileName: path.basename(input.fileName).replace(/[\x00-\x1f]/g, '_'),
        size: image.data.length, width: image.width, height: image.height, orientation: image.orientation, mimeType: image.mimeType,
        sha256: hash(image.data), createdAt: new Date().toISOString(), managed: true };
      const receipt: Receipt = { version: 1, asset, owner, fingerprint };
      const temp = path.join(this.directory, `.tmp-${randomUUID()}`);
      await fs.mkdir(temp, { mode: 0o700 });
      try {
        for (const [name, content] of [['image', image.data], ['receipt.json', JSON.stringify(receipt)]] as const) {
          const handle = await fs.open(path.join(temp, name), 'wx', 0o600);
          try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
        }
        guard(); await fs.rename(temp, path.join(this.directory, input.assetId));
        this.entries.set(input.assetId, receipt);
      } finally { await fs.rm(temp, { recursive: true, force: true }); }
      return structuredClone(asset);
    });
    this.writes = run.catch(() => {}); return run;
  }
  async drain() { await this.writes; }
}
