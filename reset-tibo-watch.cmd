@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\reset-local-state.ps1" %*
set "TIBO_RESET_EXIT=%ERRORLEVEL%"
if not "%TIBO_RESET_EXIT%"=="0" pause
exit /b %TIBO_RESET_EXIT%
