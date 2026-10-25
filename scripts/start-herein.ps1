param(
  [switch]$RebuildNative,
  [switch]$NoSandbox,
  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$logDir = Join-Path $root 'tmp'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$transcriptPath = Join-Path $logDir 'start-herein.log'
try {
  Start-Transcript -Path $transcriptPath -Force | Out-Null
} catch {
  # Transcript is best-effort; startup should not depend on it.
}

function Write-Step($text) {
  Write-Host "`n== $text ==" -ForegroundColor Cyan
}

function Fail($text) {
  Write-Host "`nStartup failed: $text" -ForegroundColor Red
  try { Stop-Transcript | Out-Null } catch {}
  exit 1
}

$node = (Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $node) {
  $node = @(
    'D:\Dev\node\node.exe',
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\node\node.exe')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $node) {
  Fail 'Node.js not found. Install Node 22+ first.'
}

$env:PATH = "$(Split-Path $node);$env:PATH"

$preferredUserData = Join-Path $env:APPDATA 'herein'
$userDataRoot = $env:HEREIN_USER_DATA_DIR

if (-not $userDataRoot) {
  try {
    $preferredData = Join-Path $preferredUserData 'data'
    New-Item -ItemType Directory -Path $preferredData -Force | Out-Null
    $probe = Join-Path $preferredData ('.herein-write-probe-' + [guid]::NewGuid())
    [System.IO.File]::WriteAllText($probe, 'ok')
    Remove-Item $probe -Force
    $userDataRoot = $preferredUserData
  } catch {
    $userDataRoot = Join-Path $root '.herein-data'
    $env:HEREIN_USER_DATA_DIR = $userDataRoot
    $targetData = Join-Path $userDataRoot 'data'
    New-Item -ItemType Directory -Path $targetData -Force | Out-Null
    $sourceDb = Join-Path $preferredUserData 'data\app.db'
    $targetDb = Join-Path $targetData 'app.db'

    if ((Test-Path $sourceDb) -and -not (Test-Path $targetDb)) {
      Copy-Item $sourceDb $targetDb -Force
    }

    $sourceAssets = Join-Path $preferredUserData 'data\assets'
    $targetAssets = Join-Path $targetData 'assets'

    if ((Test-Path $sourceAssets) -and -not (Test-Path $targetAssets)) {
      Copy-Item $sourceAssets $targetAssets -Recurse -Force
    }

    Write-Host "AppData is not writable from this shell; using portable data: $userDataRoot" -ForegroundColor Yellow
  }
}

$dataDir = Join-Path $userDataRoot 'data'
try {
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  $probe = Join-Path $dataDir ('.herein-write-probe-' + [guid]::NewGuid())
  [System.IO.File]::WriteAllText($probe, 'ok')
  Remove-Item $probe -Force
} catch {
  Fail "The HereIn data directory is not writable ($dataDir). Set HEREIN_USER_DATA_DIR to a writable folder."
}

if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) {
  Fail 'Electron is missing. Run npm install in the repository root first.'
}

$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$electronVersion = (& $node -p "require('electron/package.json').version").Trim()
$nativeModule = Join-Path $root 'node_modules\better-sqlite3\build\Release\better_sqlite3.node'

$nativeOk = $false
if (Test-Path $nativeModule) {
  $env:ELECTRON_RUN_AS_NODE = '1'
  & $electron -e "require('better-sqlite3')" 2>$null | Out-Null
  $nativeOk = $LASTEXITCODE -eq 0
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}

$needsRebuild = $RebuildNative -or -not $nativeOk

if ($needsRebuild) {
  $runningElectron = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($root) } |
    Select-Object -First 1

  if ($runningElectron) {
    Fail "Close Herein (pid $($runningElectron.ProcessId)) before rebuilding better-sqlite3; the running app holds better_sqlite3.node."
  }

  Write-Step "Rebuilding better-sqlite3 for Electron $electronVersion"
  npm run native:rebuild:electron
  if ($LASTEXITCODE -ne 0) {
    Fail 'better-sqlite3 rebuild failed.'
  }

  $env:ELECTRON_RUN_AS_NODE = '1'
  & $electron -e "require('better-sqlite3')" 2>$null | Out-Null
  $abiOk = $LASTEXITCODE -eq 0
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

  if (-not $abiOk) {
    Fail 'better-sqlite3 does not load under Electron after rebuild.'
  }
} else {
  Write-Host "native module is built for Electron $electronVersion" -ForegroundColor DarkGray
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

$baseArgs = @('.')
if ($NoSandbox) {
  $baseArgs += @('--no-sandbox', '--disable-gpu')
}

function Test-LoopbackPort([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(250)) {
      return $false
    }
    $client.EndConnect($pending)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

$ttsPort = if ($env:HEREIN_TTS_PORT) { [int]$env:HEREIN_TTS_PORT } else { 9881 }
if ($env:HEREIN_VOICE_MODE -eq 'legacy' -and $env:HEREIN_TTS_SERVICE -ne '0' -and $env:HEREIN_AUTO_VOICE -ne '0' -and $env:HEREIN_TTS_AUTO -ne '0' -and -not (Test-LoopbackPort $ttsPort)) {
  $ttsPython = if ($env:HEREIN_TTS_PYTHON) { $env:HEREIN_TTS_PYTHON } else { 'D:\AI\tools\qwen_tts\venv\Scripts\python.exe' }
  $ttsModel = if ($env:HEREIN_TTS_MODEL) {
    $env:HEREIN_TTS_MODEL
  } elseif (Test-Path (Join-Path $root 'tmp\models\qwen3-tts-0.6b-customvoice')) {
    Join-Path $root 'tmp\models\qwen3-tts-0.6b-customvoice'
  } else {
    Join-Path $root 'tmp\models\qwen3-tts-customvoice'
  }
  $ttsScript = Join-Path $root 'scripts\qwen3_tts_service.py'

  if ((Test-Path $ttsPython) -and (Test-Path $ttsModel) -and (Test-Path $ttsScript)) {
    Write-Step 'Starting local TTS service'
    $logDir = Join-Path $root 'tmp'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $env:HF_HUB_OFFLINE = '1'
    $env:TRANSFORMERS_OFFLINE = '1'
    $env:PYTHONUNBUFFERED = '1'
    $ttsOut = Join-Path $logDir 'herein-tts.out.log'
    $ttsErr = Join-Path $logDir 'herein-tts.err.log'
    $ttsArgs = @(
      $ttsScript,
      '--mode', 'custom_voice',
      '--model', $ttsModel,
      '--host', '127.0.0.1',
      '--port', [string]$ttsPort,
      '--device', $(if ($env:HEREIN_TTS_DEVICE) { $env:HEREIN_TTS_DEVICE } else { 'cuda:0' }),
      '--no-flash-attn'
    )
    $ttsProcess = Start-Process -FilePath $ttsPython -ArgumentList $ttsArgs -WorkingDirectory $root -WindowStyle Hidden `
      -RedirectStandardOutput $ttsOut -RedirectStandardError $ttsErr -PassThru
    if ($ttsProcess) {
      Set-Content -LiteralPath (Join-Path $logDir 'herein-tts.pid') -Value $ttsProcess.Id
    }
  } else {
    Write-Host 'TTS service was not started: local python or model is missing.' -ForegroundColor DarkGray
  }
}

Write-Step "Starting Herein (Electron $electronVersion)"
$logDir = Join-Path $root 'tmp'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$outLog = Join-Path $logDir 'herein-electron.out.log'
$errLog = Join-Path $logDir 'herein-electron.err.log'
Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue

$process = Start-Process -FilePath $electron -ArgumentList $baseArgs -WorkingDirectory $root -PassThru `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog
Start-Sleep -Seconds 3

if ($process.HasExited -and -not $NoSandbox) {
  Write-Host 'First launch exited; retrying with compatibility flags (--no-sandbox --disable-gpu)...' -ForegroundColor Yellow
  $process = Start-Process -FilePath $electron `
    -ArgumentList (@('.') + @('--no-sandbox', '--disable-gpu')) `
    -WorkingDirectory $root -PassThru `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  Start-Sleep -Seconds 3
}

if ($process.HasExited) {
  Write-Host "Electron exited during startup (code $($process.ExitCode))." -ForegroundColor Red
  if (Test-Path $errLog) {
    Get-Content $errLog -Tail 40 | Write-Host
  }
  Fail "Electron did not stay running. Logs: $outLog / $errLog"
}

Write-Host "Started (PID $($process.Id)). Logs: tmp\herein-electron.out.log / tmp\herein-electron.err.log" -ForegroundColor Green
Write-Host 'If Windows Firewall asks, click Cancel: Herein only listens on 127.0.0.1 and needs no inbound access.' -ForegroundColor DarkGray
Write-Host 'If Windows asks whether to open this .cmd, click Open once; the launcher does not create shortcuts.' -ForegroundColor DarkGray
try { Stop-Transcript | Out-Null } catch {}
