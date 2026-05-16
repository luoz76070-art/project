@echo off
setlocal
cd /d "%~dp0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\manager\MobileCodexManager.ps1"
if errorlevel 1 (
  echo.
  echo Mobile Codex Manager failed to start.
  echo Check the error above, then press any key to close.
  pause >nul
)
