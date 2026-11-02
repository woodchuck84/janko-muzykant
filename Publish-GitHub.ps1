param(
    [string]$Repository,
    [Security.SecureString]$DriveApiKey,
    [string]$DriveProxyUrl,
    [switch]$ReleaseOnly,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Invoke-Gh {
    & gh @args
    if ($LASTEXITCODE -ne 0) { throw 'GitHub command failed. Read the error above. No success is assumed.' }
}
function Invoke-GhOptional {
    $previous = $ErrorActionPreference
    try { $ErrorActionPreference = 'Continue'; & gh @args 2>$null; $script:optionalExit = $LASTEXITCODE }
    finally { $ErrorActionPreference = $previous }
}
$account = (& gh api user --jq .login)
if ($LASTEXITCODE -ne 0 -or -not $account) { throw 'Run gh auth login on your PERSONAL GitHub account first.' }
$account = $account.Trim()
Write-Host "ACTIVE GITHUB ACCOUNT: $account" -ForegroundColor Yellow
if ($account -match 'volvo' -and -not $Force) {
    throw 'Work account detected. Refusing publication. Log into your personal account. -Force overrides this protection only when deliberately chosen.'
}
if (-not $Repository) { $Repository = Read-Host "Enter exact PERSONAL owner/repository (owner must be $account)" }
if ($Repository -notmatch '^[A-Za-z0-9-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid owner/repository.' }
$owner, $name = $Repository.Split('/')
if ($owner -ine $account) { throw 'This script publishes only to the explicitly confirmed active personal account.' }
if ($name -ieq "$owner.github.io") { throw 'Use a project repository name, not an account-root github.io repository.' }
Write-Host "PUBLIC SOURCE CODE at https://github.com/$Repository" -ForegroundColor Yellow
Write-Host 'No data, recordings, keys or APK signing material may be committed. The APK is distributed publicly via Releases.'
if ((Read-Host "Type the exact owner/repository again to authorize publication") -cne $Repository) { throw 'Confirmation mismatch. Nothing published.' }
if ((git branch --show-current) -ne 'main') { throw 'Switch to the prepared main branch before publishing.' }
if (git status --porcelain) { throw 'Working tree is not clean. Review and commit intended source changes first; never add data or keys.' }
& node scripts\check-staged.mjs --all
if ($LASTEXITCODE -ne 0) { throw 'Repository hygiene check failed.' }
$site = "https://$owner.github.io/$name/"
$existing = Invoke-GhOptional repo view $Repository --json nameWithOwner,visibility
if ($script:optionalExit -ne 0) {
    if ($ReleaseOnly) { throw 'Repository does not exist. First run without -ReleaseOnly.' }
    Invoke-Gh repo create $Repository --public --description 'Vox Apostoli choir practice: standalone Android and Windows PWA'
} elseif (($existing | ConvertFrom-Json).visibility -ne 'PUBLIC') { throw 'Repository must be public for the free Pages setup. No visibility was changed.' }
$remote = "https://github.com/$Repository.git"
if (-not $ReleaseOnly) {
    if (-not $DriveApiKey -and -not $DriveProxyUrl) {
        $DriveApiKey = Read-Host 'Drive API key (hidden; Enter skips, but Drive will need a configured proxy)' -AsSecureString
    }
    if ($DriveApiKey -and $DriveApiKey.Length -gt 0) {
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($DriveApiKey)
        try {
            # Pipe through stdin rather than exposing the key in command-line process arguments.
            [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | & gh secret set VITE_GOOGLE_DRIVE_API_KEY --repo $Repository
            if ($LASTEXITCODE -ne 0) { throw 'Could not set Drive API-key repository secret.' }
        } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    }
    if ($DriveProxyUrl) {
        $proxy = [Uri]$DriveProxyUrl
        if ($proxy.Scheme -ne 'https' -or $proxy.UserInfo -or $proxy.Query -or $proxy.Fragment) { throw 'Proxy URL must be HTTPS without credentials/query/fragment.' }
        Invoke-Gh variable set VITE_JANKO_DRIVE_PROXY_URL --repo $Repository --body $DriveProxyUrl
    }
}
$previousUrl = $env:VITE_JANKO_DISTRIBUTION_URL
try {
    $env:VITE_JANKO_DISTRIBUTION_URL = $site.TrimEnd('/')
    & npm.cmd run android:apk
    if ($LASTEXITCODE -ne 0) { throw 'APK build failed. Nothing pushed.' }
} finally { $env:VITE_JANKO_DISTRIBUTION_URL = $previousUrl }
$build = Get-Content -LiteralPath 'Janko-Muzykant-apk.json' -Raw | ConvertFrom-Json
$hash = (Get-FileHash -LiteralPath 'Janko-Muzykant-debug.apk' -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $build.sha256) { throw 'APK build hash mismatch.' }
$version = @{
    webVersion = $build.apkVersion; apkVersion = $build.apkVersion; versionCode = $build.versionCode
    sha256 = $hash; apkUrl = "https://github.com/$Repository/releases/latest/download/Janko-Muzykant-debug.apk"
    bytes = (Get-Item -LiteralPath 'Janko-Muzykant-debug.apk').Length
}
$version | ConvertTo-Json | Set-Content -LiteralPath 'release-version.json' -Encoding UTF8
if (git status --porcelain) { throw 'Build modified tracked files. Review them before publication.' }
$tag = "v$($build.apkVersion)"
if ($ReleaseOnly) {
    $remoteHead = & git ls-remote $remote refs/heads/main
    if ($LASTEXITCODE -ne 0 -or -not $remoteHead -or ($remoteHead -split '\s+')[0] -ne (git rev-parse HEAD)) {
        throw 'Remote main must match the clean local source commit. Publish source changes without -ReleaseOnly first.'
    }
} else {
    Invoke-Gh auth setup-git --hostname github.com
    & git push $remote main:main
    if ($LASTEXITCODE -ne 0) { throw 'Push failed. No force push attempted.' }
    Invoke-GhOptional api "repos/$Repository/pages" --silent
    if ($script:optionalExit -eq 0) { Invoke-Gh api --method PUT "repos/$Repository/pages" -f build_type=workflow }
    else { Invoke-Gh api --method POST "repos/$Repository/pages" -f build_type=workflow }
}
Invoke-GhOptional release view $tag --repo $Repository --json tagName --jq .tagName | Out-Null
if ($script:optionalExit -ne 0) {
    Invoke-Gh release create $tag --repo $Repository --target main --title "Janko Muzykant $($build.apkVersion)" --notes 'Standalone APK; install over the previous version to preserve local data. SHA-256 is in version.json.' --latest
} else {
    if ((Read-Host "Release $tag already exists. Type REPLACE to replace its APK and metadata") -cne 'REPLACE') { throw 'Existing release unchanged.' }
}
# The asset name is stable for /releases/latest/download links.
$temporary = Join-Path ([IO.Path]::GetTempPath()) ("janko-release-" + [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temporary | Out-Null
$releaseAsset = Join-Path $temporary 'version.json'
Copy-Item -LiteralPath 'release-version.json' -Destination $releaseAsset
try { Invoke-Gh release upload $tag Janko-Muzykant-debug.apk $releaseAsset --repo $Repository --clobber }
finally {
    Remove-Item -LiteralPath $releaseAsset -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $temporary -ErrorAction SilentlyContinue
}
Invoke-Gh release edit $tag --repo $Repository --latest
Invoke-Gh workflow run pages.yml --repo $Repository --ref main
Write-Host "Share after the Pages workflow succeeds: $site" -ForegroundColor Green
Write-Host "Watch: gh run list --repo $Repository --workflow pages.yml"
Write-Host 'This command has requested deployment; it has not verified the live site.'
