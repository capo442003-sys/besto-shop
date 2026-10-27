# Génère les fichiers de config depuis deploy/.deploy.env (Windows)
# Usage : powershell -ExecutionPolicy Bypass -File deploy/apply-config.ps1

$ErrorActionPreference = 'Stop'
$DeployDir = $PSScriptRoot
$Root = Split-Path $DeployDir -Parent
$EnvFile = Join-Path $DeployDir '.deploy.env'
$OutDir = Join-Path $DeployDir 'generated'

if (-not (Test-Path $EnvFile)) {
    Write-Host 'Copiez deploy/.deploy.env.example vers deploy/.deploy.env et remplissez les valeurs.'
    exit 1
}

function Read-DeployEnv($path) {
    $vars = @{}
    Get-Content $path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { return }
        $i = $line.IndexOf('=')
        if ($i -lt 1) { return }
        $key = $line.Substring(0, $i).Trim()
        $val = $line.Substring($i + 1).Trim()
        $vars[$key] = $val
    }
    return $vars
}

$cfg = Read-DeployEnv $EnvFile

$required = @('DOMAIN', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'WEB_PORT', 'POSTGRES_PORT')
foreach ($k in $required) {
    if (-not $cfg[$k] -or $cfg[$k] -eq 'A_REMPLIR') {
        Write-Host "Remplissez $k dans deploy/.deploy.env"
        exit 1
    }
}

$domain = $cfg['DOMAIN']
$wwwDomain = if ($cfg['WWW_DOMAIN']) { $cfg['WWW_DOMAIN'] } else { "www.$domain" }
$webPort = $cfg['WEB_PORT']
$pgHost = if ($cfg['POSTGRES_HOST']) { $cfg['POSTGRES_HOST'] } else { 'localhost' }
$pgPort = $cfg['POSTGRES_PORT']
$dbName = $cfg['DB_NAME']
$dbUser = $cfg['DB_USER']
$dbPass = $cfg['DB_PASSWORD']
$nodeEnv = if ($cfg['NODE_ENV']) { $cfg['NODE_ENV'] } else { 'production' }
$serveClient = if ($cfg['SERVE_CLIENT']) { $cfg['SERVE_CLIENT'] } else { '1' }
$jwtExpires = if ($cfg['JWT_EXPIRES_IN']) { $cfg['JWT_EXPIRES_IN'] } else { '12h' }
$clientUrl = "https://$domain"
$appPath = if ($cfg['APP_PATH']) { $cfg['APP_PATH'] } else { '/opt/bmbgestion' }

$jwt = $cfg['JWT_SECRET']
if (-not $jwt) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $jwt = [BitConverter]::ToString($bytes).Replace('-', '').ToLower()
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$backendEnv = @"
# Généré par deploy/apply-config.ps1 — ne pas éditer à la main
PORT=$webPort
NODE_ENV=$nodeEnv
DATABASE_URL=postgresql://${dbUser}:${dbPass}@${pgHost}:${pgPort}/${dbName}
JWT_SECRET=$jwt
JWT_EXPIRES_IN=$jwtExpires
CLIENT_URL=$clientUrl
SERVE_CLIENT=$serveClient
GOOGLE_DRIVE_CLIENT_EMAIL=$($cfg['GOOGLE_DRIVE_CLIENT_EMAIL'])
GOOGLE_DRIVE_PRIVATE_KEY=$($cfg['GOOGLE_DRIVE_PRIVATE_KEY'])
GOOGLE_DRIVE_FOLDER_ID=$($cfg['GOOGLE_DRIVE_FOLDER_ID'])
"@

$backendEnv | Set-Content -Path (Join-Path $Root 'backend\.env') -Encoding UTF8

@"
NODE_ENV=$nodeEnv
SERVE_CLIENT=$serveClient
CLIENT_URL=$clientUrl
PORT=$webPort
"@ | Set-Content -Path (Join-Path $OutDir 'pm2.env') -Encoding UTF8

if ($cfg['TUNNEL_UUID'] -and $cfg['TUNNEL_UUID'] -ne 'A_REMPLIR') {
    $tunnelUuid = $cfg['TUNNEL_UUID']
    $creds = if ($cfg['CLOUDFLARED_CREDENTIALS'] -and $cfg['CLOUDFLARED_CREDENTIALS'] -ne 'A_REMPLIR') {
        $cfg['CLOUDFLARED_CREDENTIALS']
    } else {
        "/root/.cloudflared/$tunnelUuid.json"
    }
    @"
tunnel: $tunnelUuid
credentials-file: $creds

ingress:
  - hostname: $domain
    service: http://127.0.0.1:${webPort}
  - hostname: $wwwDomain
    service: http://127.0.0.1:${webPort}
  - service: http_status:404
"@ | Set-Content -Path (Join-Path $OutDir 'cloudflared-config.yml') -Encoding UTF8
    Write-Host 'OK deploy/generated/cloudflared-config.yml'

    if ($cfg['CLOUDFLARED_TOKEN']) {
        $tokenRaw = $cfg['CLOUDFLARED_TOKEN'].Trim()
        $tokenJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tokenRaw))
        $token = $tokenJson | ConvertFrom-Json
        $credObj = [ordered]@{
            AccountTag   = $token.a
            TunnelSecret = $token.s
            TunnelID     = $token.t
        }
        $credObj | ConvertTo-Json | Set-Content -Path (Join-Path $OutDir 'cloudflared-credentials.json') -Encoding UTF8
        $tokenRaw | Set-Content -Path (Join-Path $OutDir 'cloudflared-token.txt') -Encoding ASCII -NoNewline
        @"
#!/bin/bash
# Configuration tunnel Cloudflare (cloudflared deja installe)
set -euo pipefail
ROOT=`$(cd "`$(dirname "`$0")/../.." && pwd)"
cd "`$ROOT"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared introuvable — installez-le d'abord."
  exit 1
fi

echo "cloudflared : `$(cloudflared --version | head -1)"

TOKEN=`$(cat deploy/generated/cloudflared-token.txt)
CREDS="/root/.cloudflared/$tunnelUuid.json"

echo ""
echo "Configuration du tunnel BMB Gestion..."
echo ""

# Methode 1 : token (recommandee si tunnel cree dans Cloudflare)
if [ -f deploy/generated/cloudflared-token.txt ]; then
  echo ">> Enregistrement du service systemd avec le token..."
  sudo cloudflared service install "`$TOKEN"
fi

# Methode 2 : config.yml locale (hostname -> port 3001)
if [ -f deploy/generated/cloudflared-config.yml ]; then
  echo ">> Copie config.yml + credentials..."
  sudo mkdir -p /etc/cloudflared /root/.cloudflared
  sudo cp deploy/generated/cloudflared-credentials.json "`$CREDS"
  sudo cp deploy/generated/cloudflared-config.yml /etc/cloudflared/config.yml
fi

sudo systemctl enable cloudflared
sudo systemctl restart cloudflared
sudo systemctl status cloudflared --no-pager || true

echo ""
echo "OK Tunnel actif."
echo "   https://${domain}  ->  http://127.0.0.1:${webPort}"
echo "   Verifiez : curl -s http://127.0.0.1:${webPort}/api/health"
"@ | Set-Content -Path (Join-Path $OutDir 'configure-cloudflared.sh') -Encoding UTF8

        # Alias ancien nom
        Copy-Item (Join-Path $OutDir 'configure-cloudflared.sh') (Join-Path $OutDir 'install-cloudflared.sh') -Force
        @"
# Copier credentials sur le serveur (methode config.yml)
# sudo mkdir -p /root/.cloudflared
# sudo cp deploy/generated/cloudflared-credentials.json $($creds)
# sudo cp deploy/generated/cloudflared-config.yml /etc/cloudflared/config.yml
# sudo systemctl restart cloudflared
"@ | Set-Content -Path (Join-Path $OutDir 'install-cloudflared-config.sh') -Encoding UTF8
        Write-Host 'OK deploy/generated/cloudflared-credentials.json'
        Write-Host 'OK deploy/generated/install-cloudflared.sh'
    }
} else {
    Write-Host 'TUNNEL_UUID non renseigne — cloudflared-config.yml non genere'
}

@"
BMB Gestion — configuration generee
====================================
Domaine      : $clientUrl
API locale   : http://127.0.0.1:${webPort}
Base         : $dbName (user: $dbUser)
Chemin app   : $appPath

Fichiers :
  - backend/.env
  - deploy/generated/pm2.env
  - deploy/generated/cloudflared-config.yml
  - deploy/generated/install-cloudflared.sh (sur le serveur)

Sur Ubuntu (cloudflared deja installe) :
  cd $appPath
  bash deploy/generated/configure-cloudflared.sh
  npm run install:all && npm run db:migrate && npm run db:seed
  npm run build:prod
  pm2 start deploy/ecosystem.config.cjs && pm2 save
"@ | Set-Content -Path (Join-Path $OutDir 'DEPLOI.txt') -Encoding UTF8

Write-Host ''
Write-Host "OK backend/.env genere"
Write-Host "OK deploy/generated/"
Write-Host "URL publique : $clientUrl"
Write-Host 'Voir deploy/generated/DEPLOI.txt'
