$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$tokenFile = Join-Path $root 'private\credentials\core-token.txt'
$coreScript = Join-Path $root 'dist-electron\core\server.js'
$sshHost = 'ubuntu@147.224.56.120'

if (-not (Test-Path -LiteralPath $coreScript)) {
  Push-Location $root
  try {
    npm run electron:compile
  } finally {
    Pop-Location
  }
}

New-Item -ItemType Directory -Path (Split-Path $tokenFile -Parent) -Force | Out-Null

if (-not (Test-Path -LiteralPath $tokenFile)) {
  $token = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
  Set-Content -LiteralPath $tokenFile -Value $token -Encoding ASCII -NoNewline
  Write-Output "Generated Core token: $tokenFile"
}

$token = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
$env:HEREIN_CORE_HOST = '127.0.0.1'
$env:HEREIN_CORE_PORT = '8787'
$env:HEREIN_CORE_TOKEN = $token
if (-not $env:HEREIN_RELAY_URL) {
  $env:HEREIN_RELAY_URL = 'http://147.224.56.120/herein'
}
if (-not $env:HEREIN_RELAY_TOKEN) {
  $env:HEREIN_RELAY_TOKEN = $token
}
if (-not $env:HEREIN_PROACTIVE_SHARE) {
  $env:HEREIN_PROACTIVE_SHARE = '1'
}
if (-not $env:HEREIN_PROACTIVE_INTERVAL_MS) {
  $env:HEREIN_PROACTIVE_INTERVAL_MS = '5400000'
}
$qqConfig = Join-Path $root 'private\credentials\qqbot.json'
if ((Test-Path -LiteralPath $qqConfig) -and -not $env:HEREIN_QQ_ENABLED) {
  $env:HEREIN_QQ_ENABLED = '1'
  $env:HEREIN_QQ_CONFIG = $qqConfig
}

$core = $null
$healthy = $false

try {
  Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 2 | Out-Null
  $healthy = $true
} catch {
  $healthy = $false
}

if (-not $healthy) {
  $core = Start-Process -FilePath 'node' -ArgumentList $coreScript -WorkingDirectory $root -PassThru -WindowStyle Hidden

  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try {
      Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 2 | Out-Null
      $healthy = $true
      break
    } catch {
      if ($core.HasExited) {
        break
      }
    }
  }
}

if (-not $healthy) {
  if ($core -and -not $core.HasExited) {
    Stop-Process -Id $core.Id -Force
  }
  throw 'Core did not become healthy on 127.0.0.1:8787'
}

Write-Output "Core:   http://127.0.0.1:8787"
Write-Output "Public: http://147.224.56.120/herein/health"
Write-Output "Token:  $tokenFile"
Write-Output 'Starting SSH reverse tunnel (Ctrl+C stops the tunnel)...'

try {
  ssh -R 127.0.0.1:8787:127.0.0.1:8787 -N `
    -o ExitOnForwardFailure=yes `
    -o ServerAliveInterval=30 `
    -o ServerAliveCountMax=3 `
    $sshHost
} finally {
  if ($core -and -not $core.HasExited) {
    Stop-Process -Id $core.Id -Force
  }
}
