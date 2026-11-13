param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$toolsDir = Join-Path $Root ".tools"
$downloadsDir = Join-Path $toolsDir "downloads"

. (Join-Path $PSScriptRoot "android-env.ps1")

$activeJdk = $env:JAVA_HOME
$androidHome = $env:ANDROID_HOME
$cmdlineLatest = Join-Path $androidHome "cmdline-tools\latest"

New-Item -ItemType Directory -Force -Path $downloadsDir, $androidHome | Out-Null

function Download-File($Url, $OutFile) {
  if (Test-Path $OutFile) {
    Write-Host "Using cached $OutFile"
    return
  }
  Write-Host "Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $OutFile
}

function Expand-ZipFresh($Zip, $Destination) {
  if (Test-Path $Destination) {
    Write-Host "Already exists $Destination"
    return
  }
  $tmp = "$Destination.tmp"
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Expand-Archive -LiteralPath $Zip -DestinationPath $tmp -Force
  Move-Item -LiteralPath $tmp -Destination $Destination
}

$cmdlineZip = Join-Path $downloadsDir "android-commandlinetools-win.zip"

$cmdlineUrl = "https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip"

Download-File $cmdlineUrl $cmdlineZip

if (!(Test-Path $cmdlineLatest)) {
  $tmpCmd = Join-Path $toolsDir "cmdline-tools.tmp"
  Remove-Item -LiteralPath $tmpCmd -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $tmpCmd | Out-Null
  Expand-Archive -LiteralPath $cmdlineZip -DestinationPath $tmpCmd -Force
  $innerCmd = Join-Path $tmpCmd "cmdline-tools"
  if (!(Test-Path $innerCmd)) { throw "Android command line tools archive layout not recognized" }
  New-Item -ItemType Directory -Force -Path (Split-Path $cmdlineLatest -Parent) | Out-Null
  Move-Item -LiteralPath $innerCmd -Destination $cmdlineLatest
  Remove-Item -LiteralPath $tmpCmd -Recurse -Force
}

$env:JAVA_HOME = $activeJdk
$env:ANDROID_HOME = $androidHome
$env:ANDROID_SDK_ROOT = $androidHome
$env:PATH = "$activeJdk\bin;$cmdlineLatest\bin;$androidHome\platform-tools;$androidHome\build-tools\35.0.0;$env:PATH"

Write-Host "JAVA_HOME=$env:JAVA_HOME"
Write-Host "ANDROID_HOME=$env:ANDROID_HOME"

$sdkmanager = Join-Path $cmdlineLatest "bin\sdkmanager.bat"
if (!(Test-Path $sdkmanager)) { throw "sdkmanager not found: $sdkmanager" }

Write-Host "Accepting Android SDK licenses for project-local SDK..."
1..30 | ForEach-Object { "y" } | & $sdkmanager --licenses | Out-Host

Write-Host "Installing Android SDK packages into $androidHome..."
& $sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" | Out-Host

$requiredFiles = @(
  (Join-Path $androidHome "platform-tools\adb.exe"),
  (Join-Path $androidHome "platforms\android-35\android.jar"),
  (Join-Path $androidHome "build-tools\35.0.0\aapt2.exe")
)

foreach ($requiredFile in $requiredFiles) {
  if (!(Test-Path $requiredFile)) {
    throw "Android SDK package verification failed; missing $requiredFile"
  }
}

Write-Host "Android tools are ready."
