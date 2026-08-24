@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\reset-local-state.ps1" %*
set "TIBO_RESET_EXIT=%ERRORLEVEL%"

if not "%TIBO_RESET_EXIT%"=="0" (
  pause
  exit /b %TIBO_RESET_EXIT%
)

if /i "%~1"=="--check" exit /b 0

echo.
choice /c YN /n /m "Launch Tibo Watch now? [Y/N] "
if errorlevel 2 exit /b 0

call "%~dp0start-tibo-watch.cmd"
exit /b %ERRORLEVEL%
