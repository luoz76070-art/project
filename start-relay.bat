@echo off
setlocal
cd /d "%~dp0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-relay.ps1"
if errorlevel 1 (
  echo.
  echo Mobile Codex Relay failed to start.
)
pause
