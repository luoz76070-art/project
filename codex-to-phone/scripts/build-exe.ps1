param(
  [switch]$SkipApk,
  [string]$Version = "1.1.1-upload-fix"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Dist = Join-Path $Root "dist-exe"
$Package = Join-Path $Dist "MobileCodexExePackage-$Version"
$RelayCjs = Join-Path $Dist "relay.cjs"
$RelayBlob = Join-Path $Dist "relay.blob"
$RelayExe = Join-Path $Dist "MobileCodexRelay.exe"
$ManagerExe = Join-Path $Dist "MobileCodexManager.exe"
$WatchdogExe = Join-Path $Dist "MobileCodexWatchdog.exe"
$Csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"

function Run-Step([string]$Name, [scriptblock]$Body) {
  Write-Host ""
  Write-Host "== $Name =="
  & $Body
}

function Assert-NativeSuccess([string]$Name) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

function Read-DotEnvMap([string]$Path) {
  $map = @{
    MOBILE_CODEX_HOST = "0.0.0.0"
    MOBILE_CODEX_PORT = "8787"
    MOBILE_CODEX_TOKEN = "mobile-codex-" + [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
    CODEX_HOME = "$env:USERPROFILE\.codex"
    MOBILE_CODEX_DDNS_DOMAIN = ""
  }
  if (Test-Path $Path) {
    Get-Content -LiteralPath $Path | ForEach-Object {
      $line = $_.Trim()
      if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) { return }
      $name, $value = $line.Split("=", 2)
      if ($name) { $map[$name.Trim()] = $value.Trim() }
    }
  }
  return $map
}

New-Item -ItemType Directory -Force -Path $Dist | Out-Null

Run-Step "Bundle relay runtime" {
  $esbuild = Join-Path $Root "node_modules\.pnpm\esbuild@0.27.7\node_modules\esbuild\bin\esbuild"
  if (!(Test-Path $esbuild)) {
    throw "esbuild not found. Run pnpm install on the development machine before building exe."
  }
  & node $esbuild "apps\relay\src\serverExe.ts" --bundle --platform=node --format=cjs --target=node24 "--outfile=$RelayCjs"
  Assert-NativeSuccess "esbuild"
}

Run-Step "Create Node SEA blob" {
  $seaConfig = Join-Path $Dist "sea-config.json"
  $json = @{
    main = "dist-exe/relay.cjs"
    output = "dist-exe/relay.blob"
    disableExperimentalSEAWarning = $true
  } | ConvertTo-Json -Depth 4
  Set-Content -LiteralPath $seaConfig -Value $json -Encoding UTF8
  if (Test-Path $RelayBlob) { Remove-Item -LiteralPath $RelayBlob -Force }
  & node --experimental-sea-config $seaConfig
  Assert-NativeSuccess "node sea"
}

Run-Step "Inject relay exe" {
  $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
  Copy-Item -LiteralPath $nodeExe -Destination $RelayExe -Force
  & npx --yes postject@1.0.0-alpha.6 $RelayExe NODE_SEA_BLOB $RelayBlob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
  Assert-NativeSuccess "postject"
  Get-Item $RelayExe | Select-Object FullName, Length, LastWriteTime | Format-List
}

Run-Step "Compile manager exe" {
  if (!(Test-Path $Csc)) { throw "C# compiler not found: $Csc" }
  & $Csc /nologo /target:winexe /optimize+ /codepage:65001 "/out:$ManagerExe" "/reference:System.dll" "/reference:System.Core.dll" "/reference:System.Drawing.dll" "/reference:System.Windows.Forms.dll" (Join-Path $Root "scripts\manager\MobileCodexManager.cs")
  Assert-NativeSuccess "csc"
  Get-Item $ManagerExe | Select-Object FullName, Length, LastWriteTime | Format-List
}

Run-Step "Compile watchdog exe" {
  if (!(Test-Path $Csc)) { throw "C# compiler not found: $Csc" }
  & $Csc /nologo /target:winexe /optimize+ /codepage:65001 "/out:$WatchdogExe" "/reference:System.dll" "/reference:System.Core.dll" (Join-Path $Root "scripts\manager\MobileCodexWatchdog.cs")
  Assert-NativeSuccess "csc watchdog"
  Get-Item $WatchdogExe | Select-Object FullName, Length, LastWriteTime | Format-List
}

if (!$SkipApk) {
  Run-Step "Ensure APK exists" {
    $apk = Join-Path $Root "dist-apk\mobile-codex-$Version-debug.apk"
    if (!(Test-Path $apk)) {
      Push-Location $Root
      try {
        & .\build-apk.bat
        Assert-NativeSuccess "build-apk"
      } finally { Pop-Location }
    }
    Get-Item $apk | Select-Object FullName, Length, LastWriteTime | Format-List
  }
}

Run-Step "Assemble lightweight package" {
  if (Test-Path $Package) { Remove-Item -LiteralPath $Package -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $Package | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $Package "docs") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $Package "docs\html") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $Package "apk") | Out-Null

  Copy-Item -LiteralPath $ManagerExe -Destination (Join-Path $Package "MobileCodexManager.exe") -Force
  Copy-Item -LiteralPath $WatchdogExe -Destination (Join-Path $Package "MobileCodexWatchdog.exe") -Force
  Copy-Item -LiteralPath $RelayExe -Destination (Join-Path $Package "MobileCodexRelay.exe") -Force
  $versionedApk = Join-Path $Root "dist-apk\mobile-codex-$Version-debug.apk"
  $fallbackApk = Join-Path $Root "dist-apk\mobile-codex-debug.apk"
  $apkSource = if (Test-Path $versionedApk) { $versionedApk } else { $fallbackApk }
  Copy-Item -LiteralPath $apkSource -Destination (Join-Path $Package "apk\mobile-codex-$Version-debug.apk") -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath (Join-Path $Root "docs\html\ipv4-lan.html") -Destination (Join-Path $Package "docs\html\ipv4-lan.html") -Force
  Copy-Item -LiteralPath (Join-Path $Root "docs\html\ipv6-ddnsgo.html") -Destination (Join-Path $Package "docs\html\ipv6-ddnsgo.html") -Force
  Copy-Item -LiteralPath (Join-Path $Root "docs\html\token-security.html") -Destination (Join-Path $Package "docs\html\token-security.html") -Force
  Copy-Item -LiteralPath (Join-Path $Root "docs\html\troubleshooting.html") -Destination (Join-Path $Package "docs\html\troubleshooting.html") -Force
  Copy-Item -LiteralPath (Join-Path $Root "docs\usage.md") -Destination (Join-Path $Package "docs\usage.md") -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath (Join-Path $Root "docs\network-plan.md") -Destination (Join-Path $Package "docs\network-plan.md") -Force -ErrorAction SilentlyContinue

  $configSeed = Read-DotEnvMap (Join-Path $Root ".env.local")
  $envExample = @(
    "MOBILE_CODEX_HOST=$($configSeed.MOBILE_CODEX_HOST)",
    "MOBILE_CODEX_PORT=$($configSeed.MOBILE_CODEX_PORT)",
    "MOBILE_CODEX_TOKEN=$($configSeed.MOBILE_CODEX_TOKEN)",
    "CODEX_HOME=$($configSeed.CODEX_HOME)",
    "MOBILE_CODEX_DEFAULT_CWD=$Package",
    "MOBILE_CODEX_DDNS_DOMAIN=$($configSeed.MOBILE_CODEX_DDNS_DOMAIN)"
  )
  Set-Content -LiteralPath (Join-Path $Package ".env.local") -Value $envExample -Encoding UTF8

  $readme = @(
    "Mobile Codex EXE Package",
    "========================",
    "",
    "1. Double-click MobileCodexManager.exe.",
    "2. Configure Host, Port, Token, CODEX_HOME and default workspace.",
    "3. Click Save, then Start.",
    "4. Install apk/mobile-codex-$Version-debug.apk on the phone.",
    "",
    "Notes:",
    "- This package does not require node_modules, pnpm or source files.",
    "- Codex Desktop must still be installed and logged in on this PC.",
    "- The phone app uses the endpoint and token shown in MobileCodexManager.exe."
  )
  Set-Content -LiteralPath (Join-Path $Package "README.txt") -Value $readme -Encoding UTF8

  Get-ChildItem -LiteralPath $Package -Force | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
}

Run-Step "Smoke package relay exe" {
  $testPort = "8795"
  $testToken = "exe-package-smoke"
  $packageRelay = Join-Path $Package "MobileCodexRelay.exe"
  $out = Join-Path $Dist "package-relay.out.log"
  $err = Join-Path $Dist "package-relay.err.log"
  Remove-Item -LiteralPath $out,$err -Force -ErrorAction SilentlyContinue
  $env:MOBILE_CODEX_HOST = "127.0.0.1"
  $env:MOBILE_CODEX_PORT = $testPort
  $env:MOBILE_CODEX_TOKEN = $testToken
  $env:CODEX_HOME = Join-Path $env:USERPROFILE ".codex"
  $env:MOBILE_CODEX_DEFAULT_CWD = $Package
  $process = Start-Process -FilePath $packageRelay -WorkingDirectory $Package -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  Start-Sleep -Seconds 3
  try {
    $health = Invoke-RestMethod -TimeoutSec 8 -Headers @{ Authorization = "Bearer $testToken" } "http://127.0.0.1:$testPort/health"
    if (!$health.ok) { throw "Health returned ok=false" }
    [pscustomobject]@{ ok = $health.ok; mode = $health.mode; pid = $process.Id; package = $Package } | Format-List
  } finally {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "EXE package ready:"
Write-Host $Package
