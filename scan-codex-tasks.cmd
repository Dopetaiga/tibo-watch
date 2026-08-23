@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js and try again.
  pause
  exit /b 1
)

node.exe "%~dp0scripts\scan-codex-tasks.mjs"
set "TIBO_SCAN_EXIT=%ERRORLEVEL%"
echo.
if /i "%~1"=="--no-pause" exit /b %TIBO_SCAN_EXIT%
pause
exit /b %TIBO_SCAN_EXIT%
