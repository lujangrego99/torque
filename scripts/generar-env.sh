#!/usr/bin/env bash
# Crea .env (no versionado) a partir de .env.example, con JWT_SECRET y
# ADMIN_PASSWORD aleatorios. No pisa un .env existente.
#   bash scripts/generar-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env ya existe: no se modifica (borralo a mano si querés regenerarlo)."
  exit 0
fi

aleatorio() { # aleatorio <bytes> → base64 sin caracteres problemáticos para .env
  if command -v openssl >/dev/null 2>&1; then openssl rand -base64 "$1"
  else node -e "console.log(require('crypto').randomBytes($1).toString('base64'))"; fi | tr -d '\n=+/'
}

secreto="$(aleatorio 48)"
password="$(aleatorio 18)"
sed -e "s|^JWT_SECRET=.*|JWT_SECRET=$secreto|" -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$password|" .env.example > .env
chmod 600 .env
echo "Creado .env (JWT_SECRET de ${#secreto} caracteres, ADMIN_PASSWORD aleatoria)."
echo "Admin inicial: $(grep '^ADMIN_EMAIL=' .env | cut -d= -f2) — la contraseña está en .env (ADMIN_PASSWORD)."
