import type { CaptureAsset, CaptureSession } from '../../../../../shared/capture';
import type { WorkItemResponse, WorkItemSummary } from '../../../../../shared/workItem';
import { authHeaders, buildUrl, requestJson } from '../connection/http';
import { relayAuthorization } from '../connection/authorization';
import { fileToBase64 } from '../chat/attachments';
export type CaptureDraft = { title: string; detail: string; rawTranscript: string | null; files: File[] };
export type CaptureList = { storeId: string; storeRevision: number; items: WorkItemSummary[]; nextCursor: string | null };
type Send = <T>(path: string, method?: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown) => Promise<T>;
export type CaptureTransaction = {
  uid: string; mutationId: string; storeId: string | null; capture: CaptureSession; title: string; detail: string;
  files: { file: File; assetId: string; previewId: string; original?: CaptureAsset; preview?: CaptureAsset; previewFile?: File }[];
  posted: boolean; confirmed: boolean;
};
export function captureTitle(title: string, mode: CaptureSession['mode'], now = new Date()) {
  return title.trim() || `${mode === 'voice' ? '语音事项' : '图片事项'} ${now.toLocaleString('zh-CN', { hour12: false })}`;
}
export function captureTransaction(draft: CaptureDraft, now = new Date()): CaptureTransaction {
  if (!draft.files.length && !draft.rawTranscript?.trim()) throw new Error('请选择图片或录入语音原文');
  if (draft.files.length > 16 || draft.files.reduce((n, f) => n + f.size, 0) > 100 * 1024 * 1024) throw new Error('每张卡最多16张图片，合计不超过100MiB（含预览）');
  for (const f of draft.files) if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || !f.size || f.size > 25 * 1024 * 1024) throw new Error('只支持25MiB以内的静态 JPEG、PNG、WebP');
  const mode = draft.rawTranscript === null ? 'image' : 'voice', title = captureTitle(draft.title, mode, now);
  if ([...title].length > 200 || new TextEncoder().encode(draft.detail).length > 65536 || new TextEncoder().encode(draft.rawTranscript ?? '').length > 65536) throw new Error('标题最多200字，说明和原文各最多64KiB');
  return { uid: crypto.randomUUID(), mutationId: crypto.randomUUID(), storeId: null, title, detail: draft.detail,
    capture: { id: crypto.randomUUID(), mode, createdAt: now.toISOString(), assetIds: [], rawTranscript: draft.rawTranscript },
    files: draft.files.map(file => ({ file, assetId: crypto.randomUUID(), previewId: crypto.randomUUID() })), posted: false, confirmed: false };
}
export function captureApi(endpoint: string, token: string, signalSource: AbortSignal | (() => AbortSignal)) {
  const authorization = relayAuthorization(endpoint, token);
  const send: Send = (route, method = 'GET', body) => {
    const signal = typeof signalSource === 'function' ? signalSource() : signalSource;
    authorization.assertValid(); signal.throwIfAborted();
    if (!endpoint || !token || (typeof navigator !== 'undefined' && navigator.onLine === false)) throw new Error('需要连接电脑');
    return requestJson(buildUrl(endpoint, route), { method, body, signal, headers: { ...authHeaders(token), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) } });
  };
  return captureClient(send);
}
export function captureClient(send: Send) {
  let running = false;
  return {
    list(cursor?: string) { return send<CaptureList>(`/api/work-items?source=capture&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); },
    get(uid: string) { return send<WorkItemResponse>(`/api/work-items/${encodeURIComponent(uid)}`); },
    image(id: string) { return send<{ asset: CaptureAsset; dataBase64: string }>(`/api/capture-assets/${encodeURIComponent(id)}?encoding=base64`); },
    edit(uid: string, body: { mutationId: string; expectedRevision: number; title: string; detail: string }) { return send<WorkItemResponse>(`/api/work-items/${encodeURIComponent(uid)}`, 'PATCH', body); },
    remove(uid: string, body: { mutationId: string; expectedRevision: number }) { return send<{ uid: string; deleted: true; revision: number }>(`/api/work-items/${encodeURIComponent(uid)}`, 'DELETE', body); },
    async save(tx: CaptureTransaction, preview: (data: { asset: CaptureAsset; dataBase64: string }) => Promise<File>, encode = fileToBase64) {
      if (running) throw new Error('正在保存事项'); running = true;
      try {
        const info = await send<CaptureList>('/api/work-items?source=capture&limit=1');
        if (tx.storeId && info.storeId !== tx.storeId) throw new Error('电脑事项存储已变化，请核对原连接');
        tx.storeId = info.storeId;
        for (const part of tx.files) {
          if (!part.original) part.original = (await send<{ upload: CaptureAsset }>('/api/uploads', 'POST', {
            purpose: 'capture', assetId: part.assetId, captureId: tx.capture.id, role: 'original', originalAssetId: null,
            fileName: part.file.name, mimeType: part.file.type, dataBase64: await encode(part.file),
          })).upload;
          if (!part.previewFile && !part.preview) part.previewFile = await preview(await send(`/api/capture-assets/${part.assetId}?encoding=base64`));
          if (!part.preview) part.preview = (await send<{ upload: CaptureAsset }>('/api/uploads', 'POST', {
            purpose: 'capture', assetId: part.previewId, captureId: tx.capture.id, role: 'preview', originalAssetId: part.assetId,
            fileName: part.previewFile!.name, mimeType: part.previewFile!.type, dataBase64: await encode(part.previewFile!),
          })).upload;
        }
        tx.capture.assetIds = tx.files.flatMap(f => [f.assetId, f.previewId]);
        const body = { uid: tx.uid, mutationId: tx.mutationId, expectedRevision: 0, storeId: tx.storeId, kind: 'task', title: tx.title, detail: tx.detail, assets: [], codeRefs: [], capture: tx.capture };
        tx.posted = true;
        const created = await send<WorkItemResponse>('/api/work-items', 'POST', body);
        const confirmed = await send<WorkItemResponse>(`/api/work-items/${tx.uid}`);
        if (created.storeId !== tx.storeId || confirmed.storeId !== tx.storeId || confirmed.item.uid !== tx.uid || confirmed.item.capture?.id !== tx.capture.id || confirmed.item.capture.rawTranscript !== tx.capture.rawTranscript) throw new Error('事项回读未确认，请重试核对');
        tx.confirmed = true;
        return confirmed;
      } finally { running = false; }
    },
  };
}
/** Decode only the server-validated, metadata-free original. Original bytes remain on Relay. */
export async function canvasPreview({ asset, dataBase64 }: { asset: CaptureAsset; dataBase64: string }): Promise<File> {
  const image = new Image(); image.src = `data:${asset.mimeType};base64,${dataBase64}`; await image.decode();
  const w = image.naturalWidth, h = image.naturalHeight;
  if (w !== asset.width || h !== asset.height) throw new Error('图片尺寸与校验结果不一致');
  const swap = asset.orientation >= 5, ratio = Math.min(1, 1600 / Math.max(w, h));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round((swap ? h : w) * ratio)); canvas.height = Math.max(1, Math.round((swap ? w : h) * ratio));
  const context = canvas.getContext('2d'); if (!context) throw new Error('无法生成图片预览');
  const transforms: Record<number, number[]> = { 1: [1,0,0,1,0,0], 2: [-1,0,0,1,w,0], 3: [-1,0,0,-1,w,h], 4: [1,0,0,-1,0,h],
    5: [0,1,1,0,0,0], 6: [0,1,-1,0,h,0], 7: [0,-1,-1,0,h,w], 8: [0,-1,1,0,0,w] };
  const [a,b,c,d,e,f] = transforms[asset.orientation]; context.setTransform(a * ratio,b * ratio,c * ratio,d * ratio,e * ratio,f * ratio); context.drawImage(image,0,0);
  const blob = await new Promise<Blob>((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('预览生成失败')), 'image/png'));
  return new File([blob], 'preview.png', { type: 'image/png' });
}
