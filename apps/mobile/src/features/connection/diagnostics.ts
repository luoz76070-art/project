import { buildUrl, normalizeEndpoint } from "./http";
import { type DiagnosticStep } from "../../app/types";

export function openHealthUrl(endpoint: string) {
  window.open(buildUrl(endpoint, "/health"), "_blank", "noopener,noreferrer");
}

export function makeDiagnosticText(startedAt: string, endpoint: string, steps: DiagnosticStep[]) {
  return [
    `time=${startedAt}`,
    `endpoint=${normalizeEndpoint(endpoint)}`,
    ...steps.map((step) => `${step.ok ? "OK" : "FAIL"} ${step.name}: ${step.detail}`),
  ].join("\n");
}

export function connectionBadge(connectionState: "idle" | "testing" | "ok" | "error", detail: string) {
  if (connectionState === "testing") return "检测中";
  if (connectionState === "error") return "连接异常";
  if (/不可用|失败|断开|错误|timeout|timed out/i.test(detail)) return "需检查";
  if (connectionState === "ok" || /已连接|可用/i.test(detail)) return "已连接";
  return "未检测";
}
