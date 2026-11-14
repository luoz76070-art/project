import { Bot, Braces, Compass, Feather, SquareTerminal, type LucideProps } from "lucide-react";

/** One neutral glyph per Agent (no vendor logos), shared by the top bar and, later, the Agent picker. */
const icons = { codex: SquareTerminal, claude: Feather, deepseek: Compass, opencode: Braces } as const;

export function AgentIcon({ id, ...props }: { id: string } & LucideProps) {
  const Icon = icons[id as keyof typeof icons] ?? Bot;
  return <Icon aria-hidden="true" {...props} />;
}
