# build.ps1 — сборка APK «Горный хайкер»
# ВНИМАНИЕ: файл в UTF-8 с BOM (иначе PowerShell 5.1 ломает кириллицу)
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$env:JAVA_HOME = "F:\tools\jdk21"
$env:Path = "F:\tools\jdk21\bin;" + $env:Path

$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk" }
if (-not (Test-Path (Join-Path $sdk "platforms\android-35"))) {
    throw "Android SDK 35 не найден в $sdk"
}

$sdkDir = $sdk -replace "\\", "/"
Set-Content -Path (Join-Path $root "android\local.properties") -Value "sdk.dir=$sdkDir" -Encoding ascii

Push-Location $root
try {
    & npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw "cap sync failed" }

    & (Join-Path $root "android\gradlew.bat") -p (Join-Path $root "android") assembleDebug --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "gradle build failed" }
}
finally { Pop-Location }

$built = Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $built)) { throw "APK not found: $built" }

$target = Join-Path $root "hiker-debug.apk"
Copy-Item -Force $built $target
Write-Host "APK ready: $target"
