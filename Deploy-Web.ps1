param(
    [string]$ProjectName = $env:JANKO_PAGES_PROJECT,
    [switch]$Local
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
& npm.cmd run web:build
if ($LASTEXITCODE -ne 0) { throw 'Standalone PWA build failed.' }
if ($Local) {
    & npx.cmd wrangler pages dev dist-web --ip 127.0.0.1 --port 8788
} else {
    if (-not $ProjectName -or $ProjectName -notmatch '^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$') {
        throw 'Set JANKO_PAGES_PROJECT or pass -ProjectName (your Cloudflare Pages project). First run npx wrangler login.'
    }
    & npx.cmd wrangler pages deploy dist-web --project-name $ProjectName --branch main
}
if ($LASTEXITCODE -ne 0) { throw 'Cloudflare command failed. Read the message above; no successful deployment is claimed.' }
