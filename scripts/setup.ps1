# setup.ps1 — разовая установка Android SDK (эмулятор + платформы)
# UTF-8 с BOM
$ErrorActionPreference = "Stop"

$sdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$zipUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
$zipPath = Join-Path $env:TEMP "commandlinetools-win.zip"
$extractDir = Join-Path $env:TEMP "cmdline-tools-extract"
$latest = Join-Path $sdkRoot "cmdline-tools\latest"

$env:JAVA_HOME = "F:\tools\jdk21"
$env:Path = "F:\tools\jdk21\bin;" + $env:Path

New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null

if (-not (Test-Path $zipPath)) {
    Write-Host "Downloading command-line tools..."
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
}

if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
if (Test-Path $latest) { Remove-Item -Recurse -Force $latest }
New-Item -ItemType Directory -Force -Path (Split-Path $latest) | Out-Null
Move-Item -Path (Join-Path $extractDir "cmdline-tools") -Destination $latest -Force

$sdkmanager = Join-Path $latest "bin\sdkmanager.bat"

Write-Host "Accepting licenses..."
1..40 | ForEach-Object { "y" } | & cmd /c "`"$sdkmanager`" --licenses" | Out-Null

Write-Host "Installing platform + build-tools..."
& cmd /c "`"$sdkmanager`" platform-tools `"platforms;android-35`" `"build-tools;35.0.0`""

Write-Host "Installing emulator + system image (for AVD)..."
& cmd /c "`"$sdkmanager`" emulator `"system-images;android-35;google_apis;x86_64`""

Write-Host "SDK ready at $sdkRoot"
