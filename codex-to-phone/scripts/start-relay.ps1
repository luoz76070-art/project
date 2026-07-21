param(
  [switch]$Ipv6
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Set-EnvFromDotEnv([string]$Path) {
  if (!(Test-Path $Path)) { return }
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) { return }
    $name, $value = $line.Split("=", 2)
    if ($name) {
      [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
    }
  }
}

function Invoke-Pnpm {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    & pnpm @args
    return
  }
  & corepack pnpm @args
}

Push-Location $Root
try {
  Set-EnvFromDotEnv (Join-Path $Root ".env.local")
  Set-EnvFromDotEnv (Join-Path $Root ".env")

  if ($Ipv6) { $env:MOBILE_CODEX_HOST = "::" }
  if (!$env:MOBILE_CODEX_HOST) { $env:MOBILE_CODEX_HOST = "0.0.0.0" }
  if (!$env:MOBILE_CODEX_PORT) { $env:MOBILE_CODEX_PORT = "8787" }
  if (!$env:MOBILE_CODEX_TOKEN) {
    $env:MOBILE_CODEX_TOKEN = "mobile-codex-" + [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
  }
  if (!$env:MOBILE_CODEX_DEFAULT_CWD) { $env:MOBILE_CODEX_DEFAULT_CWD = $Root }
  $relayExeCandidates = @(
    (Join-Path $Root "MobileCodexRelay.exe"),
    (Join-Path $Root "dist-exe\MobileCodexRelay.exe")
  )
  $relayExe = $relayExeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  $existing = Get-NetTCPConnection -LocalPort ([int]$env:MOBILE_CODEX_PORT) -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($existing) {
    $process = Get-Process -Id $existing.OwningProcess -ErrorAction SilentlyContinue
    $name = if ($process) { $process.ProcessName } else { "unknown" }
    throw "Port $env:MOBILE_CODEX_PORT is already in use by pid=$($existing.OwningProcess) ($name). Close that Relay window or change MOBILE_CODEX_PORT."
  }

  if (!$relayExe) {
    if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
      throw "MobileCodexRelay.exe not found and pnpm not found. Use the exe package or install Node.js/pnpm for development mode."
    }

    if (!(Test-Path (Join-Path $Root "node_modules"))) {
      Write-Host "node_modules not found, running pnpm install..."
      Invoke-Pnpm install
    }

    if (!(Test-Path (Join-Path $Root "apps\relay\dist\server.js"))) {
      Write-Host "Relay build output not found, building relay..."
      Invoke-Pnpm --filter @mobile-codex/relay build
    }
  }

  Write-Host ""
  Write-Host "Mobile Codex Relay"
  Write-Host "Project: $Root"
  $listenText = if ($env:MOBILE_CODEX_HOST -eq "::") { "[::]:$env:MOBILE_CODEX_PORT" } else { "$env:MOBILE_CODEX_HOST`:$env:MOBILE_CODEX_PORT" }
  Write-Host "Listen:  $listenText"
  Write-Host "Runtime: $(if ($relayExe) { $relayExe } else { 'pnpm/node development mode' })"
  Write-Host "Token:   $env:MOBILE_CODEX_TOKEN"
  Write-Host "Default CWD: $env:MOBILE_CODEX_DEFAULT_CWD"
  Write-Host ""
  Write-Host "Phone endpoint candidates:"
  if ($env:MOBILE_CODEX_HOST -eq "::") {
    Get-NetIPAddress -AddressFamily IPv6 |
      Where-Object {
        $_.IPAddress -ne "::1" -and
        $_.IPAddress -notlike "fe80*" -and
        $_.AddressState -in @("Preferred", "Deprecated")
      } |
      Sort-Object InterfaceAlias, IPAddress |
      ForEach-Object {
        Write-Host ("  http://[{0}]:{1}  ({2})" -f $_.IPAddress, $env:MOBILE_CODEX_PORT, $_.InterfaceAlias)
      }
    Write-Host ""
    Write-Host "DDNS/Domain endpoint format:"
    Write-Host ("  http://your-ddns-domain.example:{0}" -f $env:MOBILE_CODEX_PORT)
  } else {
    Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.PrefixOrigin -ne "WellKnown"
      } |
      Sort-Object InterfaceAlias, IPAddress |
      ForEach-Object {
        Write-Host ("  http://{0}:{1}  ({2})" -f $_.IPAddress, $env:MOBILE_CODEX_PORT, $_.InterfaceAlias)
      }
  }
  Write-Host ""
  Write-Host "Keep this window open while using the phone app."
  Write-Host ""

  if ($relayExe) {
    & $relayExe
  } else {
    Invoke-Pnpm --filter @mobile-codex/relay start
  }
} finally {
  Pop-Location
}
