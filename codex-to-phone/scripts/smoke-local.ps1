$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Push-Location $Root
try {
  if (!$env:MOBILE_CODEX_PORT) { $env:MOBILE_CODEX_PORT = "8787" }
  if (!$env:MOBILE_CODEX_TOKEN) { $env:MOBILE_CODEX_TOKEN = "change-me" }

  pnpm --filter @mobile-codex/relay typecheck
  pnpm --filter @mobile-codex/mobile typecheck

  $headers = @{ Authorization = "Bearer $env:MOBILE_CODEX_TOKEN" }
  $base = "http://127.0.0.1:$env:MOBILE_CODEX_PORT"
  $health = Invoke-RestMethod "$base/health"
  $threads = Invoke-RestMethod -Headers $headers "$base/api/threads?limit=1"
  $live = Invoke-RestMethod -Headers $headers "$base/api/live/health"
  $liveControl = Invoke-RestMethod -Headers $headers "$base/api/live/control/health"
  $desktopActive = Invoke-RestMethod -Headers $headers "$base/api/desktop/active"
  $desktopControl = Invoke-RestMethod -Headers $headers "$base/api/desktop/control/health"

  [pscustomobject]@{
    healthOk = $health.ok
    healthMode = $health.mode
    codexExecutable = $health.codexExecutable
    threadCount = $threads.threads.Count
    firstThread = if ($threads.threads.Count -gt 0) { $threads.threads[0].threadName } else { "" }
    liveOk = $live.ok
    liveMode = $live.mode
    liveControlOk = $liveControl.ok
    liveControlMode = $liveControl.mode
    desktopMode = $desktopActive.mode
    desktopThreadId = $desktopActive.thread.id
    desktopControlOk = $desktopControl.ok
    desktopControlMode = $desktopControl.mode
  } | ConvertTo-Json -Depth 6
} finally {
  Pop-Location
}
