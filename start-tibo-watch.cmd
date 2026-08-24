@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js and try again.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js and try again.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Dependencies are missing. Installing once, this can take a few minutes...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo npm install failed. Fix the errors above and try again.
    pause
    exit /b 1
  )
)

if /i "%~1"=="--check" (
  echo Tibo Watch launcher check passed.
  exit /b 0
)

set "TIBO_WATCH_VERSION="
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set "TIBO_WATCH_VERSION=%%v"
echo Starting Tibo Watch v%TIBO_WATCH_VERSION% ...
call npm.cmd start
set "TIBO_EXIT_CODE=%ERRORLEVEL%"
if not "%TIBO_EXIT_CODE%"=="0" (
  echo.
  echo Tibo Watch exited with code %TIBO_EXIT_CODE%.
  pause
)
exit /b %TIBO_EXIT_CODE%
