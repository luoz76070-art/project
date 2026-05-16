$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$OutRoot = Join-Path $Root "dist-portable"
$PackageRoot = Join-Path $OutRoot "MobileCodexPortable"
$ZipPath = Join-Path $OutRoot "MobileCodexPortable.zip"
$RelayDeployRoot = Join-Path $Root ".tmp\relay-portable-deploy"

function Copy-ProjectItem([string]$RelativePath) {
  $source = Join-Path $Root $RelativePath
  if (!(Test-Path $source)) { return }
  $target = Join-Path $PackageRoot $RelativePath
  $parent = Split-Path $target -Parent
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  if ((Get-Item $source).PSIsContainer) {
    Copy-Item -LiteralPath $source -Destination $parent -Recurse -Force
  } else {
    Copy-Item -LiteralPath $source -Destination $target -Force
  }
}

if (Test-Path $PackageRoot) { Remove-Item -LiteralPath $PackageRoot -Recurse -Force }
if (Test-Path $RelayDeployRoot) { Remove-Item -LiteralPath $RelayDeployRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $PackageRoot | Out-Null

Push-Location $Root
try {
  pnpm --filter @mobile-codex/relay build
  pnpm --filter @mobile-codex/mobile build
  pnpm --filter @mobile-codex/relay --prod deploy --legacy $RelayDeployRoot
} finally {
  Pop-Location
}

$items = @(
  "apps\mobile\dist",
  "dist-apk",
  "docs",
  "scripts",
  ".env.example",
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "README.md",
  "start-relay.bat",
  "start-relay-ipv6.bat",
  "smoke-local.bat",
  "build-apk.bat",
  "MobileCodexManager.bat"
)

foreach ($item in $items) { Copy-ProjectItem $item }

New-Item -ItemType Directory -Force -Path (Join-Path $PackageRoot "apps\relay") | Out-Null
Copy-Item -LiteralPath (Join-Path $RelayDeployRoot "dist") -Destination (Join-Path $PackageRoot "apps\relay") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $RelayDeployRoot "node_modules") -Destination (Join-Path $PackageRoot "apps\relay") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $RelayDeployRoot "package.json") -Destination (Join-Path $PackageRoot "apps\relay\package.json") -Force

$nodeSource = (Get-Command node.exe -ErrorAction Stop).Source
$nodeTargetDir = Join-Path $PackageRoot "runtime\node"
New-Item -ItemType Directory -Force -Path $nodeTargetDir | Out-Null
Copy-Item -LiteralPath $nodeSource -Destination (Join-Path $nodeTargetDir "node.exe") -Force

$portableReadme = @(
  "# Mobile Codex Portable",
  "",
  "1. Install and sign in to Codex Desktop.",
  "2. No system Node.js is required; this package includes runtime\node\node.exe.",
  "3. Double click MobileCodexManager.bat.",
  "4. Configure Host, Port, Token, IPv4, IPv6, and DDNS in the manager.",
  "5. Save config, start Relay, then run tests.",
  "6. Install dist-apk\mobile-codex-debug.apk on the phone.",
  "",
  "Note: Android SDK is not included. APK rebuild still requires the development machine/toolchain."
) -join [Environment]::NewLine
Set-Content -LiteralPath (Join-Path $PackageRoot "PORTABLE_README.md") -Value $portableReadme -Encoding UTF8

if (Test-Path $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
Compress-Archive -Path (Join-Path $PackageRoot "*") -DestinationPath $ZipPath -Force

Push-Location $PackageRoot
try {
  Import-Module .\scripts\manager\MobileCodexManager.psm1 -Force
  $config = Read-MobileCodexConfig
  [pscustomobject]@{
    packageRoot = $PackageRoot
    zip = $ZipPath
    host = $config.MOBILE_CODEX_HOST
    port = $config.MOBILE_CODEX_PORT
    apkExists = Test-Path .\dist-apk\mobile-codex-debug.apk
    managerExists = Test-Path .\MobileCodexManager.bat
    nodeExists = Test-Path .\runtime\node\node.exe
    relayDepsExist = Test-Path .\apps\relay\node_modules\fastify
  } | ConvertTo-Json -Depth 4
} finally {
  Pop-Location
}
