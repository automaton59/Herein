@echo off
setlocal
chcp 65001 >nul
title Herein
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-herein.ps1" %*
if errorlevel 1 (
  echo.
  echo Herein failed to start. See the message above.
  if not defined HEREIN_NO_PAUSE pause
)
