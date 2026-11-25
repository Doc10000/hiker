# create_avd.ps1 — создаёт виртуальное устройство и ставит APK
# UTF-8 с BOM
$ErrorActionPreference = "Stop"

$sdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$env:JAVA_HOME = "F:\tools\jdk21"
$env:Path = "F:\tools\jdk21\bin;" + $env:Path

$avdmanager = Join-Path $sdkRoot "cmdline-tools\latest\bin\avdmanager.bat"
$emulator = Join-Path $sdkRoot "emulator\emulator.exe"
$adb = Join-Path $sdkRoot "platform-tools\adb.exe"

$avdName = "HikerAPI35"

# 1. AVD (если ещё нет)
$existing = & cmd /c "`"$avdmanager`" list avd -c" 2>$null
if ($existing -notcontains $avdName) {
    Write-Host "Creating AVD $avdName..."
    "no" | & cmd /c "`"$avdmanager`" create avd -n $avdName -k `"system-images;android-35;google_apis;x86_64`" -d pixel_6 --force"
} else {
    Write-Host "AVD $avdName already exists"
}

# 2. Старт эмулятора (если не запущен)
$running = & $adb devices 2>$null | Select-String "emulator"
if (-not $running) {
    Write-Host "Starting emulator..."
    Start-Process -FilePath $emulator -ArgumentList "-avd", $avdName, "-gpu", "host", "-no-snapshot-load"
    Write-Host "Waiting for boot..."
    & $adb wait-for-device
    # ждём sys.boot_completed=1
    for ($i = 0; $i -lt 60; $i++) {
        $boot = & $adb shell getprop sys.boot_completed 2>$null
        if ($boot -match "1") { break }
        Start-Sleep -Seconds 5
    }
    Write-Host "Booted."
} else {
    Write-Host "Emulator already running"
}

# 3. Установка APK
$apk = Join-Path (Split-Path $PSScriptRoot -Parent) "hiker-debug.apk"
if (Test-Path $apk) {
    & $adb install -r $apk
    Write-Host "Installed. Launching..."
    & $adb shell am start -n kz.hiker.app/.MainActivity
} else {
    Write-Host "APK not found yet: $apk (build first: scripts\build.ps1)"
}
