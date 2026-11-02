$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Test-Jdk21($path) {
    if (-not $path -or -not (Test-Path (Join-Path $path 'release'))) { return $false }
    $release = Get-Content -LiteralPath (Join-Path $path 'release') -Raw
    $version = [regex]::Match($release, 'JAVA_VERSION="(\d+)')
    return $version.Success -and [int]$version.Groups[1].Value -ge 21
}
if (-not (Test-Jdk21 $env:JAVA_HOME)) {
    $localJdk = Join-Path $PSScriptRoot 'android\.tools\jdk21\jdk-21.0.13+9'
    if (Test-Jdk21 $localJdk) { $env:JAVA_HOME = $localJdk }
    else { throw 'Set JAVA_HOME to an installed JDK 21 before building Android.' }
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
& npm.cmd run android:sync
if ($LASTEXITCODE -ne 0) { throw 'Android frontend build/sync failed.' }
$checkoutBytes = [System.Text.Encoding]::UTF8.GetBytes($PSScriptRoot)
$hash = [System.Security.Cryptography.SHA256]::Create()
try { $cacheId = ([BitConverter]::ToString($hash.ComputeHash($checkoutBytes))).Replace('-', '').ToLowerInvariant().Substring(0, 12) }
finally { $hash.Dispose() }
$buildRoot = Join-Path $env:LOCALAPPDATA "JankoMuzykant\android-build\$cacheId"
$assetSource = Join-Path $PSScriptRoot 'android\app\src\main\assets'
$assetCache = Join-Path $buildRoot 'web-assets'
New-Item -ItemType Directory -Path $assetCache -Force | Out-Null
Get-ChildItem -LiteralPath $assetCache -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($assetCache.Length + 1)
    if (-not (Test-Path -LiteralPath (Join-Path $assetSource $relative))) { Remove-Item -LiteralPath $_.FullName }
}
Get-ChildItem -LiteralPath $assetSource | Copy-Item -Destination $assetCache -Recurse -Force
& .\android\gradlew.bat -p android :app:assembleDebug --console=plain
if ($LASTEXITCODE -ne 0) { throw 'Android APK build failed. Check JDK 21 and Android SDK configuration.' }
$source = Join-Path $buildRoot 'app\outputs\apk\debug\app-debug.apk'
$destination = Join-Path $PSScriptRoot 'Janko-Muzykant-debug.apk'
Copy-Item -LiteralPath $source -Destination $destination -Force
$metadata = Get-Content -LiteralPath (Join-Path $buildRoot 'app\outputs\apk\debug\output-metadata.json') -Raw | ConvertFrom-Json
@{
    apkVersion = $metadata.elements[0].versionName
    versionCode = $metadata.elements[0].versionCode
    sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'Janko-Muzykant-apk.json') -Encoding UTF8
Write-Host "Install/update APK: $destination"
Write-Host "Disposable native build cache (outside OneDrive): $buildRoot"
Get-FileHash -LiteralPath $destination -Algorithm SHA256
