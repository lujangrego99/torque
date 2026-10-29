#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERTS="$ROOT/certs"
mkdir -p "$CERTS"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERTS/server.key" \
  -out "$CERTS/server.crt" \
  -days 365 \
  -subj "/C=AR/O=UCH/OU=Programacion Distribuida/CN=localhost"

echo "Certificado X509 autofirmado generado:"
echo "  $CERTS/server.key"
echo "  $CERTS/server.crt"
echo "En .env usar SSL_KEY_PATH y SSL_CERT_PATH."
