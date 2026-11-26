# start.ps1 — поднимает сервер метки + публичный туннель cloudflared
# Запуск:  powershell -ExecutionPolicy Bypass -File server\start.ps1
# После запуска печатает адрес — его вписать в приложение:
#   «Близкие» → «Адрес сервера метки»
$ErrorActionPreference = "Continue"

$here = Split-Path $PSScriptRoot -Parent
$port = 8087
$cf = Join-Path $PSScriptRoot "cloudflared.exe"
$trackerScript = Join-Path $PSScriptRoot "tracker.py"

# ── 1. cloudflared: качаем при первом запуске ──
if (-not (Test-Path $cf)) {
    Write-Host "[1/3] Скачиваю cloudflared (~50 МБ)..."
    $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    try {
        Invoke-WebRequest -Uri $url -OutFile $cf -UseBasicParsing -TimeoutSec 300
        Write-Host "      готово: $cf"
    } catch {
        Write-Host "      НЕ СКАЧАЛСЯ: $($_.Exception.Message)"
        Write-Host "      Скачай вручную: $url"
        Write-Host "      и положи рядом как cloudflared.exe"
    }
}

# ── 2. сервер метки ──
Write-Host "[2/3] Запускаю сервер метки на порту $port ..."
$tracker = Start-Process -FilePath "python" -ArgumentList "`"$trackerScript`" --port $port" `
    -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 2

try {
    $h = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "      health OK: $($h.Content)"
} catch {
    Write-Host "      сервер не отвечает: $($_.Exception.Message)"
}

# ── 3. публичный туннель ──
$tunnelUrl = $null
if (Test-Path $cf) {
    Write-Host "[3/3] Открываю туннель cloudflared ..."
    $log = Join-Path $env:TEMP "hiker_tunnel.log"
    Remove-Item $log, "$log.err" -ErrorAction SilentlyContinue
    $tunnel = Start-Process -FilePath $cf `
        -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$port") `
        -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $log -RedirectStandardError "$log.err"

    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 2
        $txt = ""
        foreach ($f in @($log, "$log.err")) {
            if (Test-Path $f) { $txt += (Get-Content $f -Raw -ErrorAction SilentlyContinue) }
        }
        $m = [regex]::Match($txt, "https://[a-z0-9-]+\.trycloudflare\.com")
        if ($m.Success) { $tunnelUrl = $m.Value; break }
    }
} else {
    Write-Host "[3/3] cloudflared недоступен — метка работает без сервера (данные в ссылке)"
}

Write-Host ""
Write-Host "══════════════════════════════════════════════════"
Write-Host " Сервер метки запущен"
Write-Host "   tracker : http://127.0.0.1:$port/api/health   (PID $($tracker.Id))"
if ($tunnelUrl) {
    Write-Host "   туннель : $tunnelUrl"
    Write-Host ""
    Write-Host " >> ВПИСАТЬ В ПРИЛОЖЕНИЕ: Близкие → Адрес сервера метки"
    Write-Host "    $tunnelUrl"
} else {
    Write-Host "   туннель : не поднялся (см. лог выше)"
}
Write-Host ""
Write-Host " Остановить: закройте окна python и cloudflared"
Write-Host "══════════════════════════════════════════════════"
