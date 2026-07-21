import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateMockReply } from "@/lib/ai/mock";
import { Role } from "@/lib/enums";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const messages = body.messages ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const prompt = lastUser?.content ?? "";

  const reply = generateMockReply(prompt);

  return NextResponse.json({
    reply,
    meta: {
      model: process.env.AI_MODEL ?? "mock",
      provider: process.env.AI_PROVIDER_BASE_URL ?? "mock",
      mocked: true,
      tools: [
        "get_overdue_books",
        "get_pending_borrows",
        "approve_borrow",
        "reject_borrow",
        "restock_book",
        "get_book_stats",
        "get_user_history",
      ],
      note: "MVP 阶段为接口预留。后续接入 MiniMax-M2 后将自动启用工具调用。",
    },
  });
}