$ErrorActionPreference = "Stop"

$certsDir = Join-Path $PSScriptRoot "..\certs"
New-Item -ItemType Directory -Force -Path $certsDir | Out-Null

$existentes = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.FriendlyName -eq "Taller-TP3" }
foreach ($viejo in $existentes) {
  Remove-Item "Cert:\CurrentUser\My\$($viejo.Thumbprint)" -DeleteKey
}

$cert = New-SelfSignedCertificate `
  -DnsName "localhost" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -FriendlyName "Taller-TP3" `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears(1) `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1")

$pfxPath = Join-Path $certsDir "server.pfx"
$cerPath = Join-Path $certsDir "server.cer"
$pass = ConvertTo-SecureString -String "dev-local-tp2" -Force -AsPlainText

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pass | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

Write-Host "Certificado X509 autofirmado generado:"
Write-Host "  PFX: $pfxPath"
Write-Host "  CER: $cerPath"
Write-Host "  Huella: $($cert.Thumbprint)"
Write-Host "En .env usar:"
Write-Host "  SSL_PFX_PATH=./certs/server.pfx"
Write-Host "  SSL_PFX_PASSPHRASE=dev-local-tp2"
Write-Host "Esa passphrase es solo de desarrollo local; no va en la entrega."
