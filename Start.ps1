param(
    [string]$GoogleClientId = "",
    [switch]$NoBrowser
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if ($GoogleClientId) { $env:GOOGLE_CLIENT_ID = $GoogleClientId }
$port = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($port) {
    $health = $null
    try { $health = Invoke-RestMethod "http://127.0.0.1:8000/api/health" -TimeoutSec 3 } catch { Write-Host "Existing service did not return a Janko health response." }
    if ($health.status -eq "ok" -and $health.drive_access -eq "read-only" -and $health.app -eq "janko-muzykant") {
        Write-Host "Janko is already running. Opening the existing app."
        if (-not $NoBrowser) { Start-Process "http://127.0.0.1:8000" }
        exit 0
    }
    throw "Port 8000 is in use by another service or an older Janko instance. Close that instance before starting this version."
}
$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "Install Python 3.12 or newer, with Python on PATH." }
    & $python -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw "Python dependency installation failed." }
}
if (-not (Test-Path "node_modules")) {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "Install Node.js 20.19 or newer. npm installation failed." }
}
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
$server = Start-Process -FilePath $python -ArgumentList @("-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000") -NoNewWindow -PassThru
try {
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        if ($server.HasExited) { throw "Janko server stopped before startup." }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:8000/api/health"
            if ($health.status -eq "ok") { $ready = $true; break }
        } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $ready) { throw "Server startup timed out." }
    Write-Host "`nJanko Muzykant: http://127.0.0.1:8000"
    Write-Host "Google Drive access is READ-ONLY. Close this window or press Ctrl+C to stop."
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:8000" }
    while (-not $server.HasExited) { Start-Sleep -Seconds 1 }
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
}
