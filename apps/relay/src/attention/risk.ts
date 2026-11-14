// Same patterns as the phone's approval card (apps/mobile/src/features/chat/approvalModel.ts).
// attention.test.mjs fails when the two lists drift apart.
const risks: [RegExp, string][] = [
  [/\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*[rR]|-[rR]\s+-f|-f\s+-[rR]|--recursive\b.*--force|--force\b.*--recursive)/, '递归强制删除'],
  [/(^|[;&|]\s*|\s)sudo\s/, '以管理员身份运行'],
  [/\bgit\s+push\b[^;&|]*(?:\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)/, '强制推送'],
  [/\bgit\s+reset\s+[^;&|]*--hard\b/, '丢弃未提交的改动'],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, '删除未跟踪的文件'],
  [/\bgit\s+(?:checkout|restore)\s+(?:--\s+)?\.(?:\s|$)/, '丢弃工作区改动'],
  [/\b(?:curl|wget)\b[^;&]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python3?)\b/, '下载后直接执行脚本'],
  [/\bchmod\s+(?:-R\s+)?(?:0?777|a\+rwx)\b/, '放开所有权限'],
  [/\b(?:mkfs(?:\.\w+)?|diskutil\s+(?:erase\w*|partitionDisk))\b|\bdd\s+[^;&|]*\bof=\/dev\//, '可能抹掉磁盘'],
  [/\bdrop\s+(?:table|database|schema)\b|\btruncate\s+table\b/i, '删除数据库数据'],
  [/\bkillall\b|\bkill\s+-(?:9|KILL)\b|\bpkill\s+-9\b/, '强制结束进程'],
  [/\bfind\b[^;&|]*\s-delete\b/, '批量删除文件'],
];
/** Reasons a command deserves a second look. Heuristic only: no reasons does not mean safe. */
export function commandRisks(command: string | null | undefined) {
  if (!command) return [];
  return risks.filter(([pattern]) => pattern.test(command)).map(([, reason]) => reason);
}
