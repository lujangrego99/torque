#!/usr/bin/env bash
# Deja el laboratorio en un estado inicial conocido.
#   bash scripts/reset-datos.sh          → restaura el stock a la semilla (vehículos y órdenes quedan)
#   bash scripts/reset-datos.sh --todo   → borra TODOS los volúmenes y vuelve a levantar (seed desde cero)
set -euo pipefail
cd "$(dirname "$0")/.."
GW="${GW:-http://localhost:3000}"
# TP7: reiniciar el stock es una operación ADMIN → se usa el admin inicial de .env.
set -a; . ./.env; set +a

if [ "${1:-}" = "--todo" ]; then
  echo "== docker compose down -v (se borran vehicles-data, inventory-data, workorders-data, auth-data)"
  docker compose down -v
  docker compose up -d --build --wait
  echo "Listo: 3 vehículos, 3 repuestos (stock 1/4/8), 0 órdenes y solo el usuario admin."
  exit 0
fi

echo "== POST /api/repuestos/reiniciar"
TOKEN=$(curl -s -X POST "$GW/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" |
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).accessToken||'')}catch{}})")
curl -s -X POST "$GW/api/repuestos/reiniciar" -H "Authorization: Bearer $TOKEN"
echo
