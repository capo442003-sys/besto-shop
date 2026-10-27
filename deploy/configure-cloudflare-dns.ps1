# Configure DNS Cloudflare pour bmbgestion.uk (Vercel + Railway)
# Usage : powershell -File deploy/configure-cloudflare-dns.ps1
# Prerequis : CLOUDFLARE_API_TOKEN dans deploy/.cloud.env (Zone.DNS Edit)

$ErrorActionPreference = 'Stop'
$DeployDir = $PSScriptRoot
$EnvFile = Join-Path $DeployDir '.cloud.env'

function Read-EnvFile($path) {
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

$cfg = Read-EnvFile $EnvFile
$token = $env:CLOUDFLARE_API_TOKEN
if (-not $token) { $token = $cfg['CLOUDFLARE_API_TOKEN'] }
if (-not $token -and (Test-Path "$env:USERPROFILE\.cloudflared\cert.pem")) {
    $raw = (Get-Content "$env:USERPROFILE\.cloudflared\cert.pem" -Raw) `
        -replace '-----BEGIN ARGO TUNNEL TOKEN-----','' `
        -replace '-----END ARGO TUNNEL TOKEN-----','' `
        -replace '\s',''
    $tunnel = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($raw)) | ConvertFrom-Json
    $token = $tunnel.apiToken
}
if (-not $token) {
    Write-Host 'CLOUDFLARE_API_TOKEN manquant.'
    Write-Host 'Cloudflare Dashboard -> My Profile -> API Tokens -> Create Token'
    Write-Host '  Template : Edit zone DNS | Zone : bmbgestion.uk'
    Write-Host 'Ajoutez dans deploy/.cloud.env : CLOUDFLARE_API_TOKEN=votre_token'
    exit 1
}

$domain = if ($cfg['DOMAIN']) { $cfg['DOMAIN'] } else { 'bmbgestion.uk' }
$apiTarget = if ($cfg['RAILWAY_API_URL']) { $cfg['RAILWAY_API_URL'] -replace '^https?://', '' } else { 'bmb-api-production.up.railway.app' }
$apiTarget = $apiTarget.TrimEnd('/')

$headers = @{
    Authorization = "Bearer $token"
    'Content-Type' = 'application/json'
}

function Cf-Request($Method, $Uri, $Body = $null) {
    if ($Body) {
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -Body ($Body | ConvertTo-Json)
    }
    return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers
}

Write-Host "Recherche zone $domain ..."
$zones = Cf-Request GET "https://api.cloudflare.com/client/v4/zones?name=$domain"
if (-not $zones.success -or -not $zones.result.Count) {
    Write-Host "Zone $domain introuvable sur ce compte Cloudflare."
    exit 1
}
$zoneId = $zones.result[0].id
Write-Host "Zone ID : $zoneId"

function Ensure-DnsRecord($Type, $Name, $Content, $Proxied = $false) {
    $fullName = if ($Name -eq '@') { $domain } else { "$Name.$domain" }
    $existing = Cf-Request GET "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?type=$Type&name=$fullName"
    $payload = @{
        type = $Type
        name = $Name
        content = $Content
        proxied = $Proxied
        ttl = 1
    }
    if ($existing.result.Count -gt 0) {
        $id = $existing.result[0].id
        $cur = $existing.result[0].content
        if ($cur -eq $Content -and [bool]$existing.result[0].proxied -eq $Proxied) {
            Write-Host "OK deja configure : $Type $Name -> $Content"
            return
        }
        Cf-Request PUT "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records/$id" $payload | Out-Null
        Write-Host "Mis a jour : $Type $Name -> $Content (proxy=$Proxied)"
    } else {
        Cf-Request POST "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" $payload | Out-Null
        Write-Host "Cree : $Type $Name -> $Content (proxy=$Proxied)"
    }
}

# Vercel (DNS only = pas de proxy orange)
Ensure-DnsRecord 'A' '@' '76.76.21.21' $false
Ensure-DnsRecord 'CNAME' 'www' 'cname.vercel-dns.com' $false
# Railway API
Ensure-DnsRecord 'CNAME' 'api' $apiTarget $false

Write-Host ''
Write-Host 'DNS Cloudflare configure.'
Write-Host "  https://$domain"
Write-Host "  https://www.$domain"
Write-Host "  https://api.$domain"
