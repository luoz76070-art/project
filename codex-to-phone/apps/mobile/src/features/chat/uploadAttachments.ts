import type { PendingAttachment, UploadResponse } from "../../app/types";
import { apiPost, buildUrl } from "../connection/http";
import { fileToBase64, isImageFile, mimeTypeFromName, revokeAttachmentPreviews } from "./attachments";

export async function uploadAttachments(endpoint: string, token: string, files: File[], signal?: AbortSignal) {
  const uploaded: PendingAttachment[] = [];
  try {
    for (const file of files) {
      signal?.throwIfAborted();
      if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} 超过 25MB`);
      const dataBase64 = await fileToBase64(file);
      signal?.throwIfAborted();
      const response = await apiPost<UploadResponse>(buildUrl(endpoint, "/api/uploads"), token, { fileName: file.name, dataBase64 }, signal);
      signal?.throwIfAborted();
      uploaded.push({ id: `upload-${crypto.randomUUID()}`, fileName: response.upload.originalName || response.upload.fileName || file.name,
        path: response.upload.path, relativePath: response.upload.relativePath, size: response.upload.size, createdAt: response.upload.createdAt,
        mimeType: file.type || mimeTypeFromName(file.name), previewUrl: isImageFile(file) ? URL.createObjectURL(file) : null });
    }
    return uploaded;
  } catch (error) { revokeAttachmentPreviews(uploaded); throw error; }
}
