export type VoiceConfig = { region: "cn" | "sg"; workspace: string; qwenConfigured: boolean; deepseekConfigured: boolean; deepseekBaseUrl: string; qwenBaseUrl: string; asrModel: string; promptModel: string };
export type VoiceRecording = { sessionId: string; dataBase64?: string; durationMs?: number; error?: string };

export function parseVoiceConfig(raw: unknown): VoiceConfig {
  if (!raw || typeof raw !== "object") throw new Error("语音配置响应无效，请更新电脑网关");
  const value = raw as Record<string, unknown>;
  if (!["cn", "sg"].includes(String(value.region)) || typeof value.workspace !== "string" || typeof value.qwenConfigured !== "boolean" || typeof value.deepseekConfigured !== "boolean" || typeof value.asrModel !== "string" || typeof value.promptModel !== "string") throw new Error("语音配置响应无效，请更新电脑网关");
  if (typeof value.deepseekBaseUrl !== "string" || !value.deepseekBaseUrl || typeof value.qwenBaseUrl !== "string" || !value.qwenBaseUrl) throw new Error("语音地址配置需要更新电脑网关");
  return value as VoiceConfig;
}

export function parseVoiceText(raw: unknown): string {
  if (!raw || typeof raw !== "object" || !("text" in raw) || typeof raw.text !== "string" || !raw.text.trim() || raw.text.length > 20_000) throw new Error("未收到完整文字，请保留原文后重新操作");
  return raw.text.trim();
}

export function mergeVoiceDraft(original: string, current: string, text: string): string {
  if (current !== original) throw new Error("输入框内容已变化，请复制所需文字后自行粘贴");
  const next = current.trim() ? `${current}\n\n${text.trim()}` : text.trim();
  if (next.length > 20_000) throw new Error("合并后超过20000字，请先精简内容");
  return next;
}

const nativeErrors: Record<string, string> = {
  voice_microphone_denied: "未获得麦克风权限，请在系统设置允许后重试。",
  voice_recording_busy: "麦克风正在使用，请结束当前录音后重试。",
  voice_recording_failed: "无法开始或完成录音，请确认麦克风可用后重试。",
  voice_recording_too_short: "录音过短或文件不完整，请重新录音。",
  voice_interrupted: "录音已中断，请保持应用在前台后重录。",
  voice_cancelled: "录音已取消。",
};
export function voiceError(error: unknown) {
  const message = error instanceof Error ? error.message : "语音处理失败，请重试";
  if (message === "HTTP 404") return "当前电脑网关尚未支持语音，请先更新网关。";
  return nativeErrors[message] ?? (message.startsWith("HTTP") || message.startsWith("语音") || message.startsWith("未收到") || message.startsWith("输入框") || message.startsWith("合并后") ? message : "语音处理失败，请检查连接和配置后手动重试。");
}
