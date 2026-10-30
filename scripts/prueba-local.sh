#!/usr/bin/env bash
# Configuración por entorno: corre los 4 servicios con Node (sin Docker para
# las apps), con las MISMAS fuentes que usa Compose. Solo cambian variables:
# localhost + puertos 3001/3002/3003 en lugar de nombres DNS de Compose.
#
# Requiere Node ≥ 20 y npm. MongoDB y Redis se levantan acá como contenedores
# sueltos en puertos alternativos (27018 / 6380) para no chocar con un Mongo o
# Memurai local; si ya tenés MongoDB/Memurai instalados, podés apuntar
# MONGO_LOCAL / REDIS_LOCAL a ellos y no hace falta Docker.
#
#   bash scripts/prueba-local.sh
set -uo pipefail
cd "$(dirname "$0")/.."

EVID="docs/tp6/evidencias/13-ejecucion-local.txt"
MONGO_LOCAL="${MONGO_LOCAL:-mongodb://127.0.0.1:27018}"
REDIS_LOCAL="${REDIS_LOCAL:-redis://127.0.0.1:6380}"
# Puertos locales (los del .env.example son 3001-3003 + 3000; acá se usan
# otros por defecto para poder correrlo con el Compose levantado al mismo tiempo).
P_VEH="${P_VEH:-3101}"; P_INV="${P_INV:-3102}"; P_WO="${P_WO:-3103}"; P_GW="${P_GW:-3100}"; P_AUTH="${P_AUTH:-3104}"
# TP7: secreto JWT y admin efímeros, solo para esta corrida (no se escriben a disco).
JWT_LOCAL="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
ADMIN_PASS_LOCAL="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
LOGS="$(mktemp -d)"
PIDS=()

limpiar() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done
  docker rm -f torque-local-mongo torque-local-redis >/dev/null 2>&1
  rm -rf "$LOGS"
}
trap limpiar EXIT

: > "$EVID"
ej() { { echo; echo "\$ $*"; eval "$@" 2>&1; echo; } | tee -a "$EVID"; }
nota() { echo "# $*" | tee -a "$EVID"; }

if [ -z "${SIN_DOCKER:-}" ]; then
  docker run -d --rm --name torque-local-mongo -p 27018:27017 mongo:7 --quiet >/dev/null
  docker run -d --rm --name torque-local-redis -p 6380:6379 redis:7-alpine >/dev/null
fi

for s in vehicles-service inventory-service workorders-service auth-service api-gateway; do
  (cd "services/$s" && npm ci --omit=dev --no-audit --no-fund --silent)
done

arrancar() { # arrancar <servicio> VAR=valor ...
  local s="$1"; shift
  (cd "services/$s" && exec env JWT_SECRET="$JWT_LOCAL" "$@" node src/index.js > "$LOGS/$s.log" 2>&1) &
  PIDS+=($!)
}

nota "Ejecución local: mismo código, configuración distinta (variables de entorno)."
arrancar vehicles-service   PORT=$P_VEH MONGODB_URI="$MONGO_LOCAL/vehicles"
arrancar inventory-service  PORT=$P_INV MONGODB_URI="$MONGO_LOCAL/inventory" REDIS_URL="$REDIS_LOCAL" DEMO_DELAY_MS=500
arrancar workorders-service PORT=$P_WO MONGODB_URI="$MONGO_LOCAL/workorders" \
  VEHICLES_SERVICE_URL=http://localhost:$P_VEH INVENTORY_SERVICE_URL=http://localhost:$P_INV
arrancar auth-service       PORT=$P_AUTH MONGODB_URI="$MONGO_LOCAL/auth" BCRYPT_ROUNDS=10 \
  ADMIN_EMAIL=admin@torque.local ADMIN_PASSWORD="$ADMIN_PASS_LOCAL"
arrancar api-gateway        PORT=$P_GW HTTPS_PORT=3543 \
  VEHICLES_SERVICE_URL=http://localhost:$P_VEH INVENTORY_SERVICE_URL=http://localhost:$P_INV WORKORDERS_SERVICE_URL=http://localhost:$P_WO \
  AUTH_SERVICE_URL=http://localhost:$P_AUTH
sleep 8

ej "grep -h 'Escuchando\\|escuchando\\|Ruta interna\\|MongoDB conectado\\|Redis conectado' \$LOGS/*.log | cut -c26-"
ej "curl -s http://localhost:$P_GW/health/servicios"
TOKEN=$(curl -s -X POST "http://localhost:$P_GW/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"admin@torque.local\",\"password\":\"$ADMIN_PASS_LOCAL\"}" |
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).accessToken||'')}catch{}})")
nota "Login local del admin (auth-service en :$P_AUTH): token de ${#TOKEN} caracteres."
ej "curl -s -X POST http://localhost:$P_GW/api/ordenes -H 'content-type: application/json' -H \"Authorization: Bearer \$TOKEN\" -d '{\"vehiculoId\":\"68c000000000000000000001\",\"descripcion\":\"Prueba local\",\"repuestos\":[{\"repuestoId\":\"68c000000000000000000012\",\"cantidad\":1}]}' -w '\nHTTP %{http_code}'"
ej "grep -h 'POST /api/ordenes' \$LOGS/*.log | cut -c26-"
nota "Comparar con docker-compose.yml: allí las mismas variables valen http://vehicles-service:3000, mongodb://vehicles-db:27017/vehicles, etc."
