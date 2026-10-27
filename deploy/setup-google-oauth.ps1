# Configure Google OAuth pour sauvegardes Drive (BMB Gestion)
# Usage : powershell -ExecutionPolicy Bypass -File deploy/setup-google-oauth.ps1
#
# Prérequis : gcloud auth login (compte Google)
# Si création projet GCP : accepter les CGU sur https://console.cloud.google.com/

$ErrorActionPreference = 'Stop'
$DeployDir = $PSScriptRoot
$Root = Split-Path $DeployDir -Parent
$EnvFile = Join-Path $DeployDir '.cloud.env'
$CloudExample = Join-Path $DeployDir '.cloud.env.example'

function Read-DeployEnv($path) {
    $vars = @{}
    if (-not (Test-Path $path)) { return $vars }
    Get-Content $path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { return }
        $i = $line.IndexOf('=')
        if ($i -lt 1) { return }
        $vars[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim()
    }
    return $vars
}

function Ensure-GcloudAuth {
    if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
        Write-Host 'gcloud CLI introuvable. Installez Google Cloud SDK.'
        exit 1
    }
    $accounts = gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>$null
    if (-not $accounts) {
        Write-Host 'Connexion Google Cloud...'
        gcloud auth login --brief
    }
    Write-Host "Compte GCP : $(gcloud auth list --filter=status:ACTIVE --format='value(account)')"
}

function Get-OrCreate-GcpProject {
    param([string]$ProjectId, [string]$SupportEmail)

    $existing = gcloud projects list --filter="projectId:$ProjectId" --format='value(projectId)' 2>$null
    if ($existing) {
        Write-Host "Projet GCP existant : $ProjectId"
        gcloud config set project $ProjectId | Out-Null
        return $ProjectId
    }

    Write-Host "Création projet GCP $ProjectId ..."
    $create = gcloud projects create $ProjectId --name='BMB Gestion' 2>&1
    if ($LASTEXITCODE -ne 0) {
        if ($create -match 'Terms of Service') {
            Write-Host ''
            Write-Host 'ACTION REQUISE : ouvrez https://console.cloud.google.com/ et acceptez les conditions Google Cloud.'
            Write-Host 'Puis relancez ce script.'
            Start-Process 'https://console.cloud.google.com/welcome'
            exit 1
        }
        throw $create
    }
    gcloud config set project $ProjectId | Out-Null
    return $ProjectId
}

function Enable-GoogleDriveApi {
    param([string]$ProjectId)
    Write-Host 'Activation Google Drive API...'
    gcloud services enable drive.googleapis.com --project=$ProjectId
    gcloud services enable people.googleapis.com --project=$ProjectId
}

function Open-OAuthConsole {
    param([string]$ProjectId, [string]$RedirectUri)
    $consent = "https://console.cloud.google.com/apis/credentials/consent?project=$ProjectId"
    $creds = "https://console.cloud.google.com/apis/credentials?project=$ProjectId"
    Write-Host ''
    Write-Host '=== Console Google Cloud (une fois) ==='
    Write-Host "1. Écran de consentement OAuth : $consent"
    Write-Host '   - Type : Externe | Nom : BMB Gestion | Email support : votre Gmail'
    Write-Host '   - Scopes : .../auth/drive.file + .../auth/userinfo.email'
    Write-Host "2. Identifiants → Créer → ID client OAuth → Application Web"
    Write-Host "   URI de redirection : $RedirectUri"
    Write-Host "3. Copiez Client ID et Client secret dans deploy/.cloud.env"
    Write-Host ''
    Start-Process $consent
    Start-Sleep -Seconds 2
    Start-Process $creds
}

function Set-RailwayOAuthVars {
    param([string]$ClientId, [string]$ClientSecret, [string]$ServiceName)

    if (-not $ClientId -or -not $ClientSecret) {
        Write-Host 'GOOGLE_OAUTH_CLIENT_ID / SECRET manquants dans deploy/.cloud.env'
        return $false
    }

    Write-Host "Configuration Railway (service $ServiceName)..."
    npx -y @railway/cli variable set "GOOGLE_OAUTH_CLIENT_ID=$ClientId" --service $ServiceName
    if ($LASTEXITCODE -ne 0) { throw 'Échec Railway GOOGLE_OAUTH_CLIENT_ID' }
    npx -y @railway/cli variable set "GOOGLE_OAUTH_CLIENT_SECRET=$ClientSecret" --service $ServiceName
    if ($LASTEXITCODE -ne 0) { throw 'Échec Railway GOOGLE_OAUTH_CLIENT_SECRET' }
    Write-Host 'OK variables OAuth sur Railway — redéploiement en cours.'
    return $true
}

# --- main ---
Ensure-GcloudAuth

if (-not (Test-Path $EnvFile)) {
    if (Test-Path $CloudExample) { Copy-Item $CloudExample $EnvFile }
    else { Write-Host 'Créez deploy/.cloud.env'; exit 1 }
}

$cfg = Read-DeployEnv $EnvFile
$apiUrl = if ($cfg['RAILWAY_API_URL']) { $cfg['RAILWAY_API_URL'].TrimEnd('/') } else { 'https://bmb-api-production.up.railway.app' }
$redirectUri = if ($cfg['GOOGLE_OAUTH_REDIRECT_URI']) { $cfg['GOOGLE_OAUTH_REDIRECT_URI'] } else { "$apiUrl/api/backups/google/callback" }
$railwayService = if ($cfg['RAILWAY_SERVICE']) { $cfg['RAILWAY_SERVICE'] } else { 'bmb-api' }
$gcpProject = if ($cfg['GCP_PROJECT_ID']) { $cfg['GCP_PROJECT_ID'] } else { 'bmb-gestion-oauth' }
$supportEmail = gcloud auth list --filter=status:ACTIVE --format='value(account)'

$clientId = $cfg['GOOGLE_OAUTH_CLIENT_ID']
$clientSecret = $cfg['GOOGLE_OAUTH_CLIENT_SECRET']

if ($clientId -and $clientSecret) {
    if (Set-RailwayOAuthVars -ClientId $clientId -ClientSecret $clientSecret -ServiceName $railwayService) {
        Write-Host ''
        Write-Host 'Terminé. Testez : bmbgestion.uk → Paramètres → Magasin → Connecter Google Drive'
        exit 0
    }
}

Get-OrCreate-GcpProject -ProjectId $gcpProject -SupportEmail $supportEmail
Enable-GoogleDriveApi -ProjectId $gcpProject
Open-OAuthConsole -ProjectId $gcpProject -RedirectUri $redirectUri

Write-Host ''
Write-Host 'Après création des identifiants OAuth, ajoutez dans deploy/.cloud.env :'
Write-Host 'GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com'
Write-Host 'GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...'
Write-Host 'GCP_PROJECT_ID=' + $gcpProject
Write-Host ''
Write-Host 'Puis relancez : powershell -File deploy/setup-google-oauth.ps1'
