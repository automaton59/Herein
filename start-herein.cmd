@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-herein.ps1" %*
if errorlevel 1 (
  echo.
  echo Herein failed to start. See the message above.
  pause
)
