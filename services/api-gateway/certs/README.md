# Certificados del gateway (no versionar)

`server.key` y `server.crt` se generan en esta carpeta y **no se suben** al
repo ni entran en la imagen (`.gitignore` / `.dockerignore`).

```bash
# Linux, WSL o Git Bash en Windows (Git for Windows trae openssl)
bash services/api-gateway/scripts/generar-certificado.sh
```

- **Docker Compose** monta esta carpeta en `/app/certs` (solo lectura). Si los
  dos archivos existen, el gateway abre HTTPS en `3443`; si no, arranca solo
  HTTP y lo avisa en el log.
- **Local con Node**: `.env` con `SSL_KEY_PATH=./certs/server.key` y
  `SSL_CERT_PATH=./certs/server.crt`.

Es autofirmado (TP2): cURL necesita `-k` y el navegador muestra advertencia.
