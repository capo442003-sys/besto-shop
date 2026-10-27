# Deploie le backend BMB sur Railway (apres `railway login`)
# Usage : powershell -File deploy/railway-setup.ps1

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Backend = Join-Path $Root 'backend'
$EnvFile = Join-Path $PSScriptRoot 'generated\railway.env'

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
    Write-Host 'Installation Railway CLI...'
    npm install -g @railway/cli
}

Write-Host 'Connexion Railway (si necessaire)...'
railway whoami 2>$null
if ($LASTEXITCODE -ne 0) {
    railway login
}

Write-Host ''
Write-Host 'Liez le service backend Railway (choisissez le projet + service API).'
Set-Location $Backend
railway link

Write-Host ''
Write-Host 'Variables depuis deploy/generated/railway.env :'
Write-Host '  Collez-les dans Railway Dashboard si pas encore fait.'
Write-Host '  DATABASE_URL = Reference PostgreSQL Railway obligatoire.'
Write-Host ''

$seed = Read-Host 'Executer db:seed maintenant ? (o/N)'
if ($seed -eq 'o' -or $seed -eq 'O') {
    railway run npm run db:seed
    Write-Host 'OK admin / admin123 — changez le mot de passe apres connexion.'
}

Write-Host ''
Write-Host 'Deploiement Railway...'
railway up

Write-Host ''
Write-Host 'Ensuite :'
Write-Host '  1. Railway -> Networking -> Custom Domain -> api.bmbgestion.uk'
Write-Host '  2. Cloudflare DNS : CNAME api -> (valeur Railway)'
Write-Host '  3. Test : curl https://api.bmbgestion.uk/api/health'
Write-Host '  4. Ouvrir https://bmb-gestion.vercel.app ou https://bmbgestion.uk'
