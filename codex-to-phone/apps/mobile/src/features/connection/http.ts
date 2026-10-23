import { type RequestJsonOptions } from "../../app/types";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

export async function apiGet<T>(url: string, token?: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(url, {
    headers: token ? authHeaders(token) : undefined,
    signal,
    connectTimeout: 8000,
    readTimeout: 60000,
  });
}

export async function apiPost<T>(url: string, token: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    signal,
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body,
    connectTimeout: 8000,
    readTimeout: 180000,
  });
}

export async function requestJson<T>(url: string, options: RequestJsonOptions = {}): Promise<T> {
  options.signal?.throwIfAborted();
  const normalizedUrl = normalizeUrl(url);
  assertSecureEndpoint(normalizedUrl);
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url: normalizedUrl,
      method: options.method ?? "GET",
      headers: options.headers,
      data: options.body,
      connectTimeout: options.connectTimeout,
      readTimeout: options.readTimeout,
      responseType: "json",
      disableRedirects: true,
    });
    options.signal?.throwIfAborted();
    ensureHttpOk(response.status, response.data);
    return parseJsonData<T>(response.data);
  }

  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("HTTP request timeout")), options.readTimeout ?? 60000);
  try {
    const response = await fetch(normalizedUrl, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status < 200 || response.status >= 300) {
      let errorData: unknown;
      try { errorData = await response.json(); } catch { /* Non-JSON proxy errors keep the HTTP status. */ }
      ensureHttpOk(response.status, errorData);
    }
    const result = await response.json() as T;
    options.signal?.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function parseJsonData<T>(data: unknown): T {
  if (typeof data === "string") {
    return JSON.parse(data) as T;
  }
  return data as T;
}

const desktopErrors: Record<string, string> = {
  desktop_control_refresh_required: "会话控制状态已失效，请重新打开该会话，等待同步完成后手动发送。",
  desktop_turn_changed: "桌面任务状态已变化，请等待同步完成后手动发送。",
  desktop_submission_pending: "上一次桌面操作仍待确认，请先核对会话记录，勿重复发送。",
  desktop_queue_unavailable: "待发队列暂不可用，请检查网关版本和连接；草稿已保留。",
  desktop_queue_limit: "待发队列已满，请先等待或取消现有待发消息。",
  desktop_queue_result_pending: "这条消息已经提交，结果待确认，暂时无法取消。",
  desktop_queue_id_conflict: "这次提交的内容发生变化，请重新打开会话核对待发消息。",
  "clientMessageId reused with different content": "消息提交标识与之前请求冲突，请先核对会话记录，勿重复发送。",
};
const voiceErrors: Record<string, string> = {
  voice_qwen_key_required: "请在设置 → 语音与提示词配置百炼 API Key。",
  voice_deepseek_key_required: "请配置 DeepSeek API Key；也可以先采用识别原文。",
  voice_deepseek_key_required_for_url: "修改 DeepSeek 地址时，请同时填写该服务商的 Key，或先清除原 Key。",
  voice_qwen_key_required_for_url: "修改百炼地址或默认地域时，请同时填写该地址的 Key，或先清除原 Key。",
  voice_audio_upgrade_required: "当前录音格式不支持 Qwen3，请升级到 APK29 或更新版本后重新录音；也可选择 Qwen-Audio-3.1。",
  voice_invalid_request: "语音参数无效，请检查配置或重新录音。",
  voice_audio_invalid: "录音文件无效或超过2MB，请重新录音。",
  voice_no_speech: "未识别到语音，请靠近麦克风后重录。",
  voice_provider_auth: "模型鉴权失败，请核对 Key、地域、工作空间及模型权限。",
  voice_provider_busy: "模型服务繁忙或额度不足，请检查账户后手动重试。",
  voice_provider_unavailable: "模型服务暂不可用，请核对 API 地址、模型名称和服务状态后手动重试。",
  voice_provider_response_invalid: "模型未返回完整文字；已获得的原文仍可采用。",
  voice_timeout: "语音服务超时，结果未知，请勿连续重复提交。",
  voice_cancelled: "语音请求已取消。",
  voice_request_used: "本次请求已处理或取消，请勿重复提交。",
  voice_busy: "已有语音请求正在处理，请稍后重试。",
  voice_unavailable: "语音服务暂不可用，请检查电脑网关。",
};

for (const [stage, label] of [["asr", "百炼语音识别"], ["refine", "DeepSeek 提示词整理"]] as const) {
  const reasons = {
    auth: "鉴权失败，请核对该服务的 Key、地域、工作空间和模型权限。",
    busy: "限流或额度不足，请检查账户后手动重试。",
    endpoint: "地址或模型不存在，请核对 API 地址和模型名称。",
    request: "请求被拒绝，请核对模型、音频格式或服务配置。",
    unavailable: "服务暂不可用，请检查地址、网络和服务状态后手动重试。",
    response_invalid: "未返回完整文字，请核对模型；已获得的原文仍可采用。",
    timeout: "请求超时，结果未知，请勿连续重复提交。",
  };
  for (const [reason, detail] of Object.entries(reasons)) voiceErrors[`voice_${stage}_${reason}`] = `${label}：${detail}`;
}

export function ensureHttpOk(status: number, data?: unknown) {
  if (status >= 200 && status < 300) return;
  let body: unknown = data;
  try { if (typeof data === "string" && data.length <= 16_384) body = JSON.parse(data); } catch { body = undefined; }
  const reason = body && typeof body === "object" && "error" in body ? body.error : undefined;
  const voiceCode = typeof reason === "string" && Object.hasOwn(voiceErrors, reason) ? reason : undefined;
  const code = voiceCode ?? (status === 409 && typeof reason === "string" && Object.hasOwn(desktopErrors, reason) ? reason : undefined);
  const detail = voiceCode ? voiceErrors[voiceCode] : code ? desktopErrors[code] : status === 409 ? "会话或提交状态发生冲突，请刷新会话并核对消息记录。" : undefined;
  throw Object.assign(new Error(status === 401 ? "HTTP 401 token 不正确" : detail ? `HTTP ${status}：${detail}` : `HTTP ${status}`), { status, ...(code ? { code } : {}) });
}

export function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function buildUrl(endpoint: string, path: string) {
  return `${normalizeEndpoint(endpoint)}${path}`;
}

export function normalizeEndpoint(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function normalizeUrl(value: string) {
  return value.trim();
}

export function toFriendlyFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "Failed to fetch" || message.includes("ConnectException") || message.includes("ECONNREFUSED")) {
    return "连接失败：确认电脑 Relay 正在运行，手机和电脑同一网络，防火墙放行 8787";
  }
  if (message.includes("timeout") || message.includes("Timed out")) {
    return "连接超时：Relay 或 Codex app-server 响应太慢，请重试";
  }
  return message;
}


export function assertSecureEndpoint(endpoint: string) {
  const url = new URL(normalizeEndpoint(endpoint));
  const host = url.hostname.toLowerCase();
  const ipv4 = host.split(".").map(Number);
  const privateV4 = ipv4.length === 4 && ipv4.every(part => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (ipv4[0] === 127 || ipv4[0] === 10 || (ipv4[0] === 192 && ipv4[1] === 168) || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) || (ipv4[0] === 169 && ipv4[1] === 254));
  const privateHost = host === "localhost" || host.endsWith(".local") || host === "[::1]" || /^\[(fc|fd|fe80:)/.test(host) || privateV4;
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && privateHost))) {
    throw new Error("公网连接需要 HTTPS；局域网和本机可使用 HTTP");
  }
}
