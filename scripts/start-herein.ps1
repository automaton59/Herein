param(
  [switch]$RebuildNative,
  [switch]$NoSandbox,
  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Write-Step($text) {
  Write-Host "`n== $text ==" -ForegroundColor Cyan
}

function Fail($text) {
  Write-Host "`nStartup failed: $text" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js not found. Install Node 22+ first.'
}

if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) {
  Fail 'Electron is missing. Run npm install in the repository root first.'
}

$electronVersion = (node -p "require('electron/package.json').version").Trim()
$markerDir = Join-Path $root 'node_modules\.cache'
$marker = Join-Path $markerDir 'herein-electron-abi'
New-Item -ItemType Directory -Path $markerDir -Force | Out-Null

$needsRebuild = $RebuildNative
if (-not $needsRebuild) {
  if (-not (Test-Path $marker)) {
    $needsRebuild = $true
  } else {
    $markerVersion = (Get-Content $marker -Raw).Trim()
    if ($markerVersion -ne $electronVersion) {
      $needsRebuild = $true
    }
  }
}

if ($needsRebuild) {
  Write-Step "Rebuilding better-sqlite3 for Electron $electronVersion"
  npm run native:rebuild:electron
  if ($LASTEXITCODE -ne 0) {
    Fail 'better-sqlite3 rebuild failed.'
  }
  Set-Content -LiteralPath $marker -Value $electronVersion -Encoding ASCII
} else {
  Write-Host "native module matches Electron $electronVersion" -ForegroundColor DarkGray
}

if (-not $NoBuild) {
  Write-Step 'Building renderer and Electron main'
  npm run build
  if ($LASTEXITCODE -ne 0) {
    Fail 'renderer build failed.'
  }

  npm run electron:compile
  if ($LASTEXITCODE -ne 0) {
    Fail 'Electron main compile failed.'
  }
}

if (-not (Test-Path 'dist\index.html')) {
  Fail 'dist/index.html is missing. Run without -NoBuild.'
}

if (-not (Test-Path 'dist-electron\main.js')) {
  Fail 'dist-electron/main.js is missing. Run without -NoBuild.'
}

# A parent terminal may have ELECTRON_RUN_AS_NODE=1. Remove it so Electron
# starts as a desktop app, not as a Node process.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:NODE_ENV = 'production'

$existing = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($root) } |
  Select-Object -First 1

if ($existing) {
  $process = Get-Process -Id $existing.ProcessId -ErrorAction SilentlyContinue
  if ($process -and $process.MainWindowHandle -ne 0) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public class HereinWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
    [HereinWindow]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
    Write-Host 'Herein is already running; brought it to the foreground.' -ForegroundColor Green
    exit 0
  }
}

$arguments = @('.')
if ($NoSandbox) {
  $arguments += '--no-sandbox'
}

Write-Step "Starting Herein (Electron $electronVersion)"
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
Start-Process -FilePath $electron -ArgumentList $arguments -WorkingDirectory $root
Write-Host 'Started. If the database is read-only, run this command from a normal desktop user shell, not a sandboxed terminal.' -ForegroundColor Green
