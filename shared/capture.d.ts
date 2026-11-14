export type CaptureMode = 'image' | 'voice';
export type CaptureSession = {
  id: string; mode: CaptureMode; createdAt: string; assetIds: string[]; rawTranscript: string | null; assetsPurgedAt?: string };
export type CaptureAsset = {
  id: string; captureId: string; role: 'original' | 'preview'; originalAssetId: string | null;
  relativePath: string; fileName: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number; width: number; height: number; orientation: number; sha256: string; createdAt: string; managed: true;
};
