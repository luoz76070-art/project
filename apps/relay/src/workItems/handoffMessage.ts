import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { WorkItem } from '../../../../shared/workItem.js';
import type { HandoffAttachment, HandoffTarget } from '../../../../shared/handoff.js';
import type { CaptureAssetStore } from '../capture/store.js';
import { workItemError } from './schema.js';
export const handoffHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** One exact text for all channels. Never accepts client-supplied file paths. */
export async function handoffMessage(item: WorkItem, target: HandoffTarget, root: string, captures: CaptureAssetStore) {
  const attachments: HandoffAttachment[] = [];
  const actualRoot = await fs.realpath(root);
  const purged = Boolean(item.capture?.assetsPurgedAt);
  for (const asset of item.assets) {
    if (purged && asset.managed) continue;
    if (path.isAbsolute(asset.relativePath) || !asset.relativePath.startsWith('mobile-uploads/') || asset.relativePath.split(/[\\/]/).includes('..')) throw workItemError('work_item_asset_unavailable', 422);
    const file = path.join(actualRoot, asset.relativePath);
    try {
      if (await fs.realpath(file) !== file || !(await fs.lstat(file)).isFile()) throw new Error('invalid path');
      const stat = await fs.stat(file);
      if (stat.size !== asset.size || stat.size > 25 * 1024 * 1024) throw new Error('invalid size');
      const data = asset.managed ? (await captures.read(asset.id)).data : await fs.readFile(file);
      const sha256 = createHash('sha256').update(data).digest('hex');
      if (asset.managed && (asset.role !== 'original' || sha256 !== asset.sha256)) throw new Error('invalid asset');
      attachments.push({ id: asset.id, fileName: asset.fileName, path: file, sha256, orientation: asset.managed ? asset.orientation : 1 });
    } catch { throw workItemError('work_item_asset_unavailable', 422); }
  }
  const text = [`事项：${item.title}`, `说明：\n${item.detail}`, ...(item.capture?.rawTranscript === null || !item.capture ? [] : [`语音原文：\n${item.capture.rawTranscript}`]),
    `目标项目 / cwd：${target.cwd}`, ...(item.codeRefs.length ? [`代码引用：\n${item.codeRefs.join('\n')}`] : []),
    ...(purged ? ['图片：已按保留期从电脑上清理，只剩文字。'] : []),
    ...(attachments.length ? [`附件（Mac 本地路径）：\n${attachments.map(a => `- ${JSON.stringify(a.fileName)} | ${JSON.stringify(a.path)}${a.orientation === 1 ? '' : ` | EXIF 方向 ${a.orientation}（像素未旋转）`}`).join('\n')}`] : [])].join('\n\n');
  if (text.length > 20_000) throw Object.assign(workItemError('work_item_handoff_text_too_long', 413), { limit: 20_000, length: text.length, excess: text.length - 20_000 });
  return { text, attachments };
}
