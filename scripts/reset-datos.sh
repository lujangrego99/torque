#!/usr/bin/env bash
# Deja el laboratorio en un estado inicial conocido.
#   bash scripts/reset-datos.sh          → restaura stock y movimientos a la semilla (vehículos y órdenes quedan)
#                                          requiere LAB_ENDPOINTS=true (endpoint de laboratorio)
#   bash scripts/reset-datos.sh --todo   → borra TODOS los volúmenes y vuelve a levantar (seed desde cero)
set -euo pipefail
cd "$(dirname "$0")/.."
GW="${GW:-http://localhost:3000}"
# Reiniciar el stock es una operación ADMIN de laboratorio → admin inicial de .env + LAB_ENDPOINTS=true.
set -a; . ./.env; set +a

if [ "${1:-}" = "--todo" ]; then
  echo "== docker compose down -v (se borran vehicles-data, inventory-data, workorders-data, auth-data)"
  docker compose down -v
  docker compose up -d --build --wait
  echo "Listo: 3 vehículos, 3 repuestos (stock 1/4/8), 0 órdenes y solo el usuario admin."
  echo "(Para la demo de carrera y reset-datos.sh sin --todo: LAB_ENDPOINTS=true docker compose up -d)"
  exit 0
fi

echo "== POST /api/repuestos/reiniciar"
TOKEN=$(curl -s -X POST "$GW/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" |
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).accessToken||'')}catch{}})")
curl -s -X POST "$GW/api/repuestos/reiniciar" -H "Authorization: Bearer $TOKEN"
echo
