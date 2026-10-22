$ErrorActionPreference = 'Stop'

$jdk = 'D:\Android\jdk21'
$sdk = 'D:\Android\sdk'
$gradleHome = 'D:\Android\gradle-home'

if (-not (Test-Path "$jdk\bin\java.exe")) {
  throw "JDK 21 not found at $jdk. Install it or update this script."
}

if (-not (Test-Path "$sdk\platforms\android-36")) {
  throw "Android SDK platform 36 not found at $sdk. Install it with sdkmanager."
}

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:GRADLE_USER_HOME = $gradleHome
$env:Path = "$jdk\bin;$sdk\platform-tools;$env:Path"

npm run android:sync
if ($LASTEXITCODE -ne 0) {
  throw "web build or cap sync failed"
}

Push-Location (Join-Path $PSScriptRoot '..\android')
try {
  & .\gradlew.bat assembleDebug --no-daemon
  if ($LASTEXITCODE -ne 0) {
    throw "gradle assembleDebug failed"
  }
} finally {
  Pop-Location
}

$source = Join-Path $PSScriptRoot '..\android\app\build\outputs\apk\debug\app-debug.apk'
$exportDir = Join-Path $PSScriptRoot '..\exports'
New-Item -ItemType Directory -Path $exportDir -Force | Out-Null
$target = Join-Path $exportDir 'herein-debug.apk'
Copy-Item -LiteralPath $source -Destination $target -Force

$item = Get-Item $target
$hash = (Get-FileHash -Algorithm SHA256 $target).Hash
Write-Output "APK: $($item.FullName)"
Write-Output "Size: $($item.Length) bytes"
Write-Output "SHA256: $hash"
