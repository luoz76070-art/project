$ErrorActionPreference = "Stop"

function Get-MobileCodexRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Get-MobileCodexEnvPath {
  return Join-Path (Get-MobileCodexRoot) ".env.local"
}

function Read-MobileCodexConfig {
  $root = Get-MobileCodexRoot
  $config = [ordered]@{
    MOBILE_CODEX_HOST = "0.0.0.0"
    MOBILE_CODEX_PORT = "8787"
    MOBILE_CODEX_TOKEN = "change-me"
    CODEX_HOME = Join-Path $env:USERPROFILE ".codex"
    MOBILE_CODEX_DEFAULT_CWD = $root
    MOBILE_CODEX_DDNS_DOMAIN = ""
  }
  $path = Get-MobileCodexEnvPath
  if (Test-Path $path) {
    Get-Content -LiteralPath $path | ForEach-Object {
      $line = $_.Trim()
      if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) { return }
      $name, $value = $line.Split("=", 2)
      if ($name) { $config[$name.Trim()] = $value.Trim() }
    }
  }
  return [pscustomobject]$config
}

function Save-MobileCodexConfig {
  param(
    [string]$HostValue,
    [string]$Port,
    [string]$Token,
    [string]$CodexHome,
    [string]$DefaultCwd,
    [string]$DdnsDomain
  )
  $path = Get-MobileCodexEnvPath
  $lines = @(
    "MOBILE_CODEX_HOST=$HostValue",
    "MOBILE_CODEX_PORT=$Port",
    "MOBILE_CODEX_TOKEN=$Token",
    "CODEX_HOME=$CodexHome",
    "MOBILE_CODEX_DEFAULT_CWD=$DefaultCwd",
    "MOBILE_CODEX_DDNS_DOMAIN=$DdnsDomain"
  )
  Set-Content -LiteralPath $path -Value $lines -Encoding UTF8
  return $path
}

function New-MobileCodexToken {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToHexString($bytes).ToLowerInvariant()
}

function Get-MobileCodexNodePath {
  $root = Get-MobileCodexRoot
  $portableNode = Join-Path $root "runtime\node\node.exe"
  if (Test-Path $portableNode) { return $portableNode }
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "node.exe not found. Portable runtime is missing and system Node.js is not installed."
}

function Get-MobileCodexRelayExecutablePath {
  $root = Get-MobileCodexRoot
  $candidates = @(
    (Join-Path $root "MobileCodexRelay.exe"),
    (Join-Path $root "dist-exe\MobileCodexRelay.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

function Get-MobileCodexRelayProcesses {
  $root = (Get-MobileCodexRoot).ToLowerInvariant()
  Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and
    ($_.CommandLine.ToLowerInvariant().Contains("apps/relay/dist/server.js") -or
      $_.CommandLine.ToLowerInvariant().Contains("mobilecodexrelay.exe")) -and
    $_.CommandLine.ToLowerInvariant().Contains($root.ToLowerInvariant())
  }
}

function Stop-MobileCodexRelay {
  $stopped = @()
  Get-MobileCodexRelayProcesses | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    $stopped += $_.ProcessId
  }
  return $stopped
}

function Start-MobileCodexRelay {
  param([switch]$Restart)
  $root = Get-MobileCodexRoot
  $config = Read-MobileCodexConfig
  if ($Restart) { Stop-MobileCodexRelay | Out-Null; Start-Sleep -Milliseconds 500 }
  $relayExe = Get-MobileCodexRelayExecutablePath
  $useExe = [bool]$relayExe
  if (!$useExe) {
    $nodePath = Get-MobileCodexNodePath
    if (!(Test-Path (Join-Path $root "apps\relay\dist\server.js"))) {
      if (Test-Path (Join-Path $root "apps\relay\src")) {
        $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
        if (!$pnpm) { throw "Relay dist is missing and pnpm is not installed. Rebuild the package on the development machine." }
      } else {
        throw "Relay dist is missing from portable package."
      }
      Push-Location $root
      try { pnpm --filter @mobile-codex/relay build | Out-Host } finally { Pop-Location }
    }
  }
  $out = Join-Path $root "manager-relay.out.log"
  $err = Join-Path $root "manager-relay.err.log"
  Remove-Item -LiteralPath $out,$err -Force -ErrorAction SilentlyContinue
  $command = "`$env:MOBILE_CODEX_HOST='$($config.MOBILE_CODEX_HOST)'; " +
    "`$env:MOBILE_CODEX_PORT='$($config.MOBILE_CODEX_PORT)'; " +
    "`$env:MOBILE_CODEX_TOKEN='$($config.MOBILE_CODEX_TOKEN)'; " +
    "`$env:CODEX_HOME='$($config.CODEX_HOME)'; " +
    "`$env:MOBILE_CODEX_DEFAULT_CWD='$($config.MOBILE_CODEX_DEFAULT_CWD)'; " +
    "Set-Location '$root'; "
  if ($useExe) {
    $command += "& '$relayExe'"
  } else {
    $command += "& '$nodePath' apps/relay/dist/server.js"
  }
  $process = Start-Process -FilePath powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  Start-Sleep -Seconds 2
  return $process
}

function Test-MobileCodexHealth {
  param(
    [string]$Endpoint,
    [string]$Token
  )
  $headers = if ($Token) { @{ Authorization = "Bearer $Token" } } else { @{} }
  $health = Invoke-RestMethod -TimeoutSec 8 -Headers $headers "$Endpoint/health"
  return $health
}

function Test-MobileCodexLocal {
  $config = Read-MobileCodexConfig
  $hostText = if ($config.MOBILE_CODEX_HOST -eq "::") { "[::1]" } else { "127.0.0.1" }
  $endpoint = "http://$hostText`:$($config.MOBILE_CODEX_PORT)"
  return Test-MobileCodexHealth -Endpoint $endpoint -Token $config.MOBILE_CODEX_TOKEN
}

function Test-MobileCodexDdns {
  $config = Read-MobileCodexConfig
  if (!$config.MOBILE_CODEX_DDNS_DOMAIN) { throw "DDNS domain is empty." }
  $endpoint = "http://$($config.MOBILE_CODEX_DDNS_DOMAIN):$($config.MOBILE_CODEX_PORT)"
  return Test-MobileCodexHealth -Endpoint $endpoint -Token $config.MOBILE_CODEX_TOKEN
}

function Get-MobileCodexIpv4Endpoints {
  $config = Read-MobileCodexConfig
  Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.PrefixOrigin -ne "WellKnown" } |
    Sort-Object InterfaceAlias, IPAddress |
    ForEach-Object { "http://$($_.IPAddress):$($config.MOBILE_CODEX_PORT)" }
}

function Get-MobileCodexIpv6Endpoints {
  $config = Read-MobileCodexConfig
  Get-NetIPAddress -AddressFamily IPv6 |
    Where-Object { $_.IPAddress -ne "::1" -and $_.IPAddress -notlike "fe80*" -and $_.AddressState -in @("Preferred", "Deprecated") } |
    Sort-Object InterfaceAlias, IPAddress |
    ForEach-Object { "http://[$($_.IPAddress)]:$($config.MOBILE_CODEX_PORT)" }
}

function Set-MobileCodexAutostart {
  param([bool]$Enabled)
  $root = Get-MobileCodexRoot
  $startup = [Environment]::GetFolderPath("Startup")
  $shortcutPath = Join-Path $startup "Mobile Codex Relay.lnk"
  if (!$Enabled) {
    Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
    return $shortcutPath
  }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $managerExe = Join-Path $root "MobileCodexManager.exe"
  if (Test-Path $managerExe) {
    $shortcut.TargetPath = $managerExe
    $shortcut.Arguments = "--start-minimized"
  } else {
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$root\scripts\start-relay.ps1`""
  }
  $shortcut.WorkingDirectory = $root
  $shortcut.WindowStyle = 7
  $shortcut.Save()
  return $shortcutPath
}

function Open-MobileCodexGuide {
  param([string]$Name)
  $root = Get-MobileCodexRoot
  $file = Join-Path $root "docs\html\$Name.html"
  if (!(Test-Path $file)) { throw "Guide not found: $Name" }
  Start-Process $file
}

Export-ModuleMember -Function *-MobileCodex*
