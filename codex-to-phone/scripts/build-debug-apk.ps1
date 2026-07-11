param(
  [string]$Version = "1.1.1-upload-fix"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "android-env.ps1")

function Invoke-Pnpm {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    & pnpm @args
    return
  }
  & corepack pnpm @args
}

function Resolve-GradleCommand([string]$StageRoot) {
  $localGradleBat = Join-Path $StageRoot "gradle-8.11.1\bin\gradle.bat"
  if (Test-Path $localGradleBat) { return $localGradleBat }

  $zip = Join-Path $StageRoot "gradle-8.11.1-bin.zip"
  $url = "https://services.gradle.org/distributions/gradle-8.11.1-bin.zip"
  Write-Host "Downloading Gradle 8.11.1..."
  Invoke-WebRequest -Uri $url -OutFile $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $StageRoot -Force
  if (!(Test-Path $localGradleBat)) {
    throw "Gradle not found after download: $localGradleBat"
  }
  return $localGradleBat
}

Push-Location $Root
try {
  Invoke-Pnpm --filter @mobile-codex/mobile build
  Invoke-Pnpm --filter @mobile-codex/mobile exec cap sync android
  & node scripts/normalize-capacitor-config.mjs
  if ($LASTEXITCODE -ne 0) { throw "normalize-capacitor-config failed with exit code $LASTEXITCODE" }

  $sourceAndroid = Join-Path $Root "apps\mobile\android"
  $sourceCapacitor = Join-Path $Root "node_modules\.pnpm\@capacitor+android@7.4.4_@capacitor+core@7.4.4\node_modules\@capacitor\android\capacitor"
  if (!(Test-Path $sourceCapacitor)) {
    throw "Capacitor Android module not found: $sourceCapacitor"
  }

  $stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) "mobile-codex-android-build"
  $stageRootFull = [System.IO.Path]::GetFullPath($stageRoot)
  $stageAndroid = Join-Path $stageRootFull "android"
  $stageCapacitorRoot = Join-Path $stageRootFull "capacitor-android"
  $stageCapacitor = Join-Path $stageCapacitorRoot "capacitor"
  $stageGradleHome = Join-Path $stageRootFull "gradle-home"

  function Remove-SafeChildDirectory([string]$Path, [string]$Parent, [string]$Leaf) {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\')
    $actualParent = [System.IO.Path]::GetFullPath((Split-Path $fullPath -Parent)).TrimEnd('\')
    if ((Split-Path $fullPath -Leaf) -ne $Leaf -or $actualParent -ne $fullParent) {
      throw "Refusing to delete unexpected path: $fullPath"
    }
    if (Test-Path $fullPath) {
      Remove-Item -LiteralPath $fullPath -Recurse -Force
    }
  }

  New-Item -ItemType Directory -Force -Path $stageRootFull, $stageGradleHome | Out-Null
  $gradleBat = Resolve-GradleCommand $stageRootFull
  Remove-SafeChildDirectory $stageAndroid $stageRootFull "android"
  Remove-SafeChildDirectory $stageCapacitorRoot $stageRootFull "capacitor-android"
  New-Item -ItemType Directory -Force -Path $stageAndroid, $stageCapacitor | Out-Null

  Write-Host "Staging Android build in $stageRootFull"
  Get-ChildItem -LiteralPath $sourceAndroid -Force |
    Where-Object { $_.Name -notin @(".gradle", "build") } |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $stageAndroid -Recurse -Force
    }
  Get-ChildItem -LiteralPath $sourceCapacitor -Force |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $stageCapacitor -Recurse -Force
    }

  $generatedSettings = @"
// Generated for staged ASCII build by scripts/build-debug-apk.ps1
include ':capacitor-android'
project(':capacitor-android').projectDir = new File('../capacitor-android/capacitor')
"@
  [System.IO.File]::WriteAllText(
    (Join-Path $stageAndroid "capacitor.settings.gradle"),
    $generatedSettings,
    [System.Text.UTF8Encoding]::new($false)
  )

  $env:GRADLE_USER_HOME = $stageGradleHome
  Write-Host "STAGED_GRADLE_USER_HOME=$env:GRADLE_USER_HOME"

  Push-Location $stageAndroid
  try {
    & $gradleBat assembleDebug --no-daemon
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}

$stageApk = Join-Path ([System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) "mobile-codex-android-build"))) "android\app\build\outputs\apk\debug\app-debug.apk"
$apkDir = Join-Path $Root "dist-apk"
$versionName = $Version
$apk = Join-Path $apkDir "mobile-codex-$versionName-debug.apk"
New-Item -ItemType Directory -Force -Path $apkDir | Out-Null
if (!(Test-Path $stageApk)) {
  throw "Staged APK not found: $stageApk"
}
Copy-Item -LiteralPath $stageApk -Destination $apk -Force
if (!(Test-Path $apk)) {
  throw "APK not found: $apk"
}
Write-Host "APK=$apk"
