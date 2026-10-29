#!/usr/bin/env bash
# Deja el laboratorio en un estado inicial conocido.
#   bash scripts/reset-datos.sh          → restaura el stock a la semilla (vehículos y órdenes quedan)
#   bash scripts/reset-datos.sh --todo   → borra TODOS los volúmenes y vuelve a levantar (seed desde cero)
set -euo pipefail
cd "$(dirname "$0")/.."
GW="${GW:-http://localhost:3000}"

if [ "${1:-}" = "--todo" ]; then
  echo "== docker compose down -v (se borran vehicles-data, inventory-data, workorders-data)"
  docker compose down -v
  docker compose up -d --build --wait
  echo "Listo: 3 vehículos, 3 repuestos (stock 1/4/8) y 0 órdenes."
  exit 0
fi

echo "== POST /api/repuestos/reiniciar"
curl -s -X POST "$GW/api/repuestos/reiniciar"
echo
