$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$toolsDir = Join-Path $Root ".tools"

function Get-JavaMajorVersion([string]$JavaExe) {
  $jdkHome = Split-Path (Split-Path $JavaExe -Parent) -Parent
  $releaseFile = Join-Path $jdkHome "release"
  if (Test-Path $releaseFile) {
    $releaseVersion = Get-Content -LiteralPath $releaseFile |
      Where-Object { $_ -match '^JAVA_VERSION="(\d+)' } |
      Select-Object -First 1
    if ($releaseVersion -and $releaseVersion -match '^JAVA_VERSION="(\d+)') {
      return [int]$Matches[1]
    }
  }

  try {
    $oldErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = & $JavaExe -version 2>&1
    $ErrorActionPreference = $oldErrorAction
    $versionLine = ($output | Select-Object -First 1)
    if ($versionLine -match '"1\.(\d+)\.') { return [int]$Matches[1] }
    if ($versionLine -match '"(\d+)(\.|")') { return [int]$Matches[1] }
  } catch {
    $ErrorActionPreference = $oldErrorAction
    return $null
  }
  return $null
}

function Test-JdkHome([string]$JdkHome) {
  if ([string]::IsNullOrWhiteSpace($JdkHome)) { return $false }
  $java = Join-Path $JdkHome "bin\java.exe"
  $javac = Join-Path $JdkHome "bin\javac.exe"
  if (!(Test-Path $java) -or !(Test-Path $javac)) { return $false }
  $major = Get-JavaMajorVersion $java
  return ($major -ge 21)
}

function Get-JdkCandidates {
  $candidates = @()
  if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
  $candidates += @(
    "C:\Program Files\Android\Android Studio\jbr",
    "C:\Program Files\Android\Android Studio\jre",
    "C:\Program Files\Android\openjdk\jdk-21.0.8",
    (Join-Path $toolsDir "jdk-21"),
    (Join-Path $toolsDir "jdk21")
  )
  foreach ($glob in @(
    "C:\Program Files\Java\jdk-*",
    "C:\Program Files\Eclipse Adoptium\jdk-*",
    "C:\Program Files\Microsoft\jdk-*",
    "C:\Program Files\Zulu\zulu-*",
    "C:\Program Files\BellSoft\LibericaJDK-*"
  )) {
    $candidates += @(Get-ChildItem -Path $glob -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
  }
  return $candidates | Where-Object { $_ } | Select-Object -Unique
}

function Ensure-LocalJdk21 {
  $localJdk = Join-Path $toolsDir "jdk-21"
  if (Test-JdkHome $localJdk) { return $localJdk }

  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  $stage = Join-Path $toolsDir "jdk-21-stage"
  $zip = Join-Path $toolsDir "jdk-21.zip"
  $url = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"

  Write-Host "Downloading JDK 21..."
  $oldProgress = $ProgressPreference
  $ProgressPreference = "SilentlyContinue"
  try {
    Invoke-WebRequest -Uri $url -OutFile $zip
  } finally {
    $ProgressPreference = $oldProgress
  }

  foreach ($path in @($stage, $localJdk)) {
    if (Test-Path $path) {
      $full = [System.IO.Path]::GetFullPath($path)
      $toolsFull = [System.IO.Path]::GetFullPath($toolsDir).TrimEnd('\')
      if (!$full.StartsWith($toolsFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove path outside .tools: $full"
      }
      Remove-Item -LiteralPath $full -Recurse -Force
    }
  }

  Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
  $extracted = Get-ChildItem -LiteralPath $stage -Directory |
    Where-Object { Test-JdkHome $_.FullName } |
    Select-Object -First 1
  if (!$extracted) {
    throw "Downloaded JDK archive did not contain a valid JDK 21."
  }
  Move-Item -LiteralPath $extracted.FullName -Destination $localJdk
  Remove-Item -LiteralPath $stage -Recurse -Force
  return $localJdk
}

$resolvedJdk = $null
foreach ($candidate in Get-JdkCandidates) {
  if (Test-JdkHome $candidate) {
    $resolvedJdk = $candidate
    break
  }
}
if (!$resolvedJdk) {
  $resolvedJdk = Ensure-LocalJdk21
}
$env:JAVA_HOME = $resolvedJdk
$env:ANDROID_HOME = Join-Path $toolsDir "android-sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = Join-Path $toolsDir "gradle-home"
$cmdlineLatest = Join-Path $env:ANDROID_HOME "cmdline-tools\latest"
$env:PATH = "$env:JAVA_HOME\bin;$cmdlineLatest\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\build-tools\35.0.0;$env:PATH"
Write-Host "JAVA_HOME=$env:JAVA_HOME"
Write-Host "ANDROID_HOME=$env:ANDROID_HOME"
Write-Host "GRADLE_USER_HOME=$env:GRADLE_USER_HOME"
