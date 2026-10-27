# Génère les configs Railway + Vercel pour bmbgestion.uk (ou autre domaine cloud)
# Usage : powershell -ExecutionPolicy Bypass -File deploy/apply-cloud-config.ps1

$ErrorActionPreference = 'Stop'
$DeployDir = $PSScriptRoot
$Root = Split-Path $DeployDir -Parent
$EnvExample = Join-Path $DeployDir '.cloud.env.example'
$EnvFile = Join-Path $DeployDir '.cloud.env'
$OutDir = Join-Path $DeployDir 'generated'

if (-not (Test-Path $EnvFile)) {
    if (-not (Test-Path $EnvExample)) {
        Write-Host 'Fichier deploy/.cloud.env.example introuvable.'
        exit 1
    }
    Copy-Item $EnvExample $EnvFile
    Write-Host 'OK deploy/.cloud.env cree depuis .cloud.env.example'
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

$domain = $cfg['DOMAIN']
if (-not $domain) {
    Write-Host 'Remplissez DOMAIN dans deploy/.cloud.env'
    exit 1
}

$wwwDomain = if ($cfg['WWW_DOMAIN']) { $cfg['WWW_DOMAIN'] } else { "www.$domain" }
$apiDomain = if ($cfg['API_DOMAIN']) { $cfg['API_DOMAIN'] } else { "api.$domain" }
$vercelProject = if ($cfg['VERCEL_PROJECT_NAME']) { $cfg['VERCEL_PROJECT_NAME'] } else { 'bmb-gestion' }
$vercelUrl = "https://${vercelProject}.vercel.app"
$clientUrl = "https://$domain,https://$wwwDomain,$vercelUrl"
$apiUrl = "https://$apiDomain"
$backendPublicUrl = if ($cfg['RAILWAY_API_URL']) { $cfg['RAILWAY_API_URL'].TrimEnd('/') } else { $apiUrl }
$frontendApiUrl = if ($cfg['VITE_API_URL']) { $cfg['VITE_API_URL'].TrimEnd('/') } elseif ($cfg['RAILWAY_API_URL']) { $cfg['RAILWAY_API_URL'].TrimEnd('/') } else { $apiUrl }
$nodeEnv = if ($cfg['NODE_ENV']) { $cfg['NODE_ENV'] } else { 'production' }
$serveClient = if ($cfg['SERVE_CLIENT']) { $cfg['SERVE_CLIENT'] } else { '0' }
$webPort = if ($cfg['PORT']) { $cfg['PORT'] } else { '3001' }
$jwtExpires = if ($cfg['JWT_EXPIRES_IN']) { $cfg['JWT_EXPIRES_IN'] } else { '12h' }
$allowVercel = if ($cfg['ALLOW_VERCEL_CORS']) { $cfg['ALLOW_VERCEL_CORS'] } else { '1' }

$jwt = $cfg['JWT_SECRET']
if (-not $jwt) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $jwt = [BitConverter]::ToString($bytes).Replace('-', '').ToLower()
    # Conserver le JWT genere pour les prochains runs
    $envContent = Get-Content $EnvFile -Raw
    if ($envContent -match '(?m)^JWT_SECRET=') {
        $envContent = $envContent -replace '(?m)^JWT_SECRET=.*', "JWT_SECRET=$jwt"
    } else {
        $envContent += "`nJWT_SECRET=$jwt"
    }
    $envContent | Set-Content -Path $EnvFile -Encoding UTF8 -NoNewline
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$railwayEnv = @"
# Coller dans Railway → service backend → Variables
NODE_ENV=$nodeEnv
SERVE_CLIENT=$serveClient
PORT=$webPort
JWT_SECRET=$jwt
JWT_EXPIRES_IN=$jwtExpires
CLIENT_URL=$clientUrl
ALLOW_VERCEL_CORS=$allowVercel
BACKEND_PUBLIC_URL=$backendPublicUrl
GOOGLE_OAUTH_REDIRECT_URI=$backendPublicUrl/api/backups/google/callback
BACKUP_CRON_ENABLED=1
# GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET — deploy/setup-google-oauth.ps1
# DATABASE_URL = reference variable PostgreSQL Railway (Add PostgreSQL au projet)
"@

$vercelEnv = @"
# Coller dans Vercel → Project → Settings → Environment Variables
# Scope : Production (+ Preview si souhaite)
VITE_API_URL=$frontendApiUrl
"@

$frontendProd = @"
# Build production local (npm run build --prefix frontend)
VITE_API_URL=$frontendApiUrl
"@

$dnsGuide = @"
BMB Gestion — DNS pour $domain
================================

1) VERCEL (frontend) — domaine $domain
   Dashboard Vercel → Project → Settings → Domains → Add :
     - $domain
     - $wwwDomain

   Le domaine utilise Cloudflare (nameservers detectes). Dans Cloudflare DNS :

   Type    Nom    Contenu              Proxy
   ----    ---    -------              -----
   A       @      76.76.21.21          DNS only (gris)
   CNAME   www    cname.vercel-dns.com DNS only (gris)

   Important : desactiver le proxy orange Cloudflare pour Vercel (sinon certificat SSL).

2) RAILWAY (API) — sous-domaine $apiDomain
   Railway → service backend → Settings → Networking → Custom Domain :
     - $apiDomain

   Enregistrement DNS :

   Type    Nom    Valeur
   ----    ---    ------
   CNAME   api    <fourni par Railway, ex. xxxx.up.railway.app>

3) APRES propagation DNS (5 min à 48 h)
   - https://$apiDomain/api/health  → status ok
   - https://$domain                → page login BMB

4) PREMIER DEPLOI Railway — seed admin (une fois) :
   railway link
   railway run npm run db:seed
   Login : admin / admin123  → changer le mot de passe
"@

$deployGuide = @"
BMB Gestion — Deploiement cloud $domain
========================================

Domaines
  Site    : https://$domain
  WWW     : https://$wwwDomain  (redirect Vercel)
  API     : $apiUrl

Fichiers generes
  deploy/generated/railway.env      → variables Railway
  deploy/generated/vercel.env         → variables Vercel
  deploy/generated/DNS-$domain.txt    → enregistrements DNS
  frontend/.env.production            → build local prod

Site Vercel (deja deploye) : https://bmb-gestion.vercel.app

ETAPE 1 — Railway
  1. https://railway.app → New Project
  2. Add PostgreSQL
  3. Add Service → GitHub repo → Root Directory = backend
  4. Variables : copier deploy/generated/railway.env
  5. DATABASE_URL : Reference → PostgreSQL
  6. Settings → Networking → Generate Domain (temporaire)
  7. Custom Domain → $apiDomain (apres DNS)
  8. Deploy

ETAPE 2 — Seed (premiere fois)
  npm i -g @railway/cli
  railway login
  railway link
  cd backend
  railway run npm run db:seed

ETAPE 3 — Vercel
  1. https://vercel.com → Import repo
  2. Root Directory = frontend
  3. Environment Variables : deploy/generated/vercel.env
  4. Deploy
  5. Settings → Domains → $domain + $wwwDomain

ETAPE 4 — DNS
  Voir deploy/generated/DNS-$domain.txt

ETAPE 5 — Verification
  curl $apiUrl/api/health
  Ouvrir https://$domain

JWT_SECRET (conserve pour Railway) :
  $jwt
"@

$railwayEnv | Set-Content -Path (Join-Path $OutDir 'railway.env') -Encoding UTF8
$vercelEnv | Set-Content -Path (Join-Path $OutDir 'vercel.env') -Encoding UTF8
$frontendProd | Set-Content -Path (Join-Path $Root 'frontend\.env.production') -Encoding UTF8
$dnsGuide | Set-Content -Path (Join-Path $OutDir "DNS-$domain.txt") -Encoding UTF8
$deployGuide | Set-Content -Path (Join-Path $OutDir 'CLOUD-DEPLOI.txt') -Encoding UTF8

# Mettre a jour l'exemple cloud avec le domaine actuel
$cloudExample = @"
# ═══════════════════════════════════════════════════════════════
# BMB — Cloud Railway + Vercel ($domain)
# Généré / synchronisé par deploy/apply-cloud-config.ps1
# ═══════════════════════════════════════════════════════════════

DOMAIN=$domain
WWW_DOMAIN=$wwwDomain
API_DOMAIN=$apiDomain

NODE_ENV=$nodeEnv
SERVE_CLIENT=$serveClient
PORT=$webPort
JWT_EXPIRES_IN=$jwtExpires
JWT_SECRET=
ALLOW_VERCEL_CORS=$allowVercel
VERCEL_PROJECT_NAME=$vercelProject

# Railway (backend) — voir deploy/generated/railway.env
CLIENT_URL=$clientUrl

# Vercel (frontend) — voir deploy/generated/vercel.env
VITE_API_URL=$apiUrl
"@
$cloudExample | Set-Content -Path (Join-Path $DeployDir 'cloud-railway-vercel.env.example') -Encoding UTF8

Write-Host ''
Write-Host "OK deploy/generated/railway.env"
Write-Host "OK deploy/generated/vercel.env"
Write-Host "OK deploy/generated/CLOUD-DEPLOI.txt"
Write-Host "OK frontend/.env.production"
Write-Host ''
Write-Host "Site  : https://$domain"
Write-Host "API   : $apiUrl"
Write-Host ''
Write-Host 'Prochaine etape : deploy/generated/CLOUD-DEPLOI.txt'
