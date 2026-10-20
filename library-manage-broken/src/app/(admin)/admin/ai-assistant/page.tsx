import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AI_TOOLS } from "@/lib/ai/tools";
import { ChatPanel } from "./chat-panel";

export default function AiAssistantPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="h-5 w-5 text-primary" />
            AI 助理
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            用自然语言询问图书借阅问题。MVP 阶段为接口预留，回复为 mock。
          </p>
        </div>
        <Badge variant="warning">演示模式</Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardContent className="p-0">
            <ChatPanel />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="mb-3 text-sm font-semibold">已注册工具</div>
            <p className="mb-4 text-xs text-muted-foreground">
              后续接入 MiniMax-M2 后将自动启用以下工具：
            </p>
            <ul className="space-y-2 text-xs">
              {AI_TOOLS.map((t) => (
                <li key={t.name} className="rounded-lg bg-muted/60 px-3 py-2">
                  <div className="font-mono font-medium text-foreground">{t.name}</div>
                  <div className="mt-0.5 text-muted-foreground">{t.description}</div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}