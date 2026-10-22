# Certificados (no versionar claves privadas)

Los archivos `server.key`, `server.crt` y `server.pfx` se generan en esta carpeta y **no se entregan**.

## Windows (PowerShell, X509)

Desde la raíz del proyecto, en PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\generar-certificado.ps1
```

Deja `certs\server.pfx` y `certs\server.cer`. En `.env`:

```
SSL_PFX_PATH=./certs/server.pfx
SSL_PFX_PASSPHRASE=dev-local-tp2
```

## Linux / WSL (OpenSSL)

```bash
bash scripts/generar-certificado.sh
```

En `.env`:

```
SSL_KEY_PATH=./certs/server.key
SSL_CERT_PATH=./certs/server.crt
```
