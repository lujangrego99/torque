#!/usr/bin/env bash
# Pruebas obligatorias del TP6 (sección 18). Requiere Docker, curl y bash
# (Linux, WSL o Git Bash). Cada sección deja su salida en docs/tp6/evidencias/.
#
#   bash scripts/pruebas-tp6.sh            → todas las secciones
#   bash scripts/pruebas-tp6.sh 08-fallo   → solo las que empiezan así
#
# Regresión después de las correcciones: levantar con LAB_ENDPOINTS=true (la
# carrera y reset-datos usan endpoints de laboratorio). Las evidencias de TP6 ya
# entregadas (tag tp6-entrega) no se vuelven a commitear.
set -uo pipefail
cd "$(dirname "$0")/.."

GW="${GW:-http://localhost:3000}"
EVID="docs/tp6/evidencias"
FILTRO="${1:-}"
JSON='content-type: application/json'
mkdir -p "$EVID"

# TP7: los endpoints de negocio requieren JWT. Estas pruebas (TP6) operan como
# ADMIN: cada curl lleva el token del admin inicial (credenciales en .env).
# El header no se muestra en la evidencia. Ver scripts/pruebas-tp7.sh para la seguridad.
[ -f .env ] || bash scripts/generar-env.sh
set -a; . ./.env; set +a
# Estas pruebas usan los endpoints de laboratorio (reiniciar / carrera): se
# fuerzan acá porque .env los deja apagados (LAB_ENDPOINTS=false).
export LAB_ENDPOINTS=true
TOKEN_ADMIN=""
curl() {
  if [ -z "$TOKEN_ADMIN" ]; then
    TOKEN_ADMIN=$(command curl -s -X POST "$GW/api/auth/login" -H 'content-type: application/json' \
      -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 2>/dev/null |
      node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).accessToken||'')}catch{}})")
  fi
  if [ -n "$TOKEN_ADMIN" ]; then command curl -H "Authorization: Bearer $TOKEN_ADMIN" "$@"; else command curl "$@"; fi
}

VEH_COROLLA=68c000000000000000000001
VEH_RANGER=68c000000000000000000002
REP_FILTRO=68c000000000000000000011
REP_PASTILLAS=68c000000000000000000012
REP_BUJIAS=68c000000000000000000013

# ------------------------------------------------------------------ helpers
seccion() {
  ACTUAL="$1"
  if [ -n "$FILTRO" ] && [[ "$ACTUAL" != "$FILTRO"* ]]; then return 1; fi
  : > "$EVID/$ACTUAL.txt"
  echo; echo "################ $ACTUAL"
  return 0
}
# Muestra el comando y su salida, y los agrega a la evidencia de la sección.
ej() {
  local mostrado
  mostrado=$(printf '%s' "$*" | sed -E \
    -e "s#req ([A-Z]+) ([^ ]+) '#curl -X \\1 $GW\\2 -H '$JSON' -d '#g" \
    -e "s#req ([A-Z]+) ([^ ;&)]+)#curl -X \\1 $GW\\2#g")
  { echo; echo "\$ $mostrado"; eval "$@" 2>&1; echo; } | tee -a "$EVID/$ACTUAL.txt"
}
nota() { echo "# $*" | tee -a "$EVID/$ACTUAL.txt"; }
req() { # req MÉTODO RUTA [BODY]  → cuerpo + "HTTP nnn"
  local m="$1" r="$2" b="${3:-}"
  if [ -n "$b" ]; then curl -s -X "$m" "$GW$r" -H "$JSON" -d "$b" -w '\nHTTP %{http_code}'
  else curl -s -X "$m" "$GW$r" -w '\nHTTP %{http_code}'; fi
}
esperar_sano() { # espera a que los servicios indicados estén healthy
  for s in "$@"; do
    for _ in $(seq 1 60); do
      id=$(docker compose ps -q "$s")
      [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)" = "healthy" ] && break
      sleep 2
    done
  done
}

# ------------------------------------------------------------------ 00 docker
if seccion "00-docker"; then
  ej docker --version
  ej docker compose version
  ej "docker info --format 'Server {{.ServerVersion}} · {{.OperatingSystem}} · {{.NCPU}} CPU · cgroup {{.CgroupVersion}}'"
  ej "docker run --rm hello-world | head -n 3"
fi

# ------------------------------------------------------------------ 01 build individual
if seccion "01-build-individual"; then
  for s in vehicles-service inventory-service workorders-service api-gateway; do
    ej "docker build -q -t torque/$s:tp6 ./services/$s 2>&1 | grep -v -i -E 'deprecated|buildx|BuildKit'"
  done
  ej "docker images 'torque/*' --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}'"
  nota "Ejecución individual de una imagen, sin su base: el proceso arranca, responde /health 503 (degraded)"
  nota "y reintenta la conexión en lugar de caerse."
  docker rm -f torque-solo >/dev/null 2>&1
  ej "docker run -d --rm --name torque-solo -p 39001:3000 -e MONGODB_URI=mongodb://no-existe:27017/vehicles -e JWT_SECRET=\$JWT_SECRET torque/vehicles-service:tp6"
  sleep 8
  ej "curl -s -w '\nHTTP %{http_code}' http://localhost:39001/health"
  ej "docker logs torque-solo 2>&1 | grep -E 'INFO|WARN|ERROR' | tail -n 4"
  docker rm -f torque-solo >/dev/null 2>&1
fi

# ------------------------------------------------------------------ 02 compose up
if seccion "02-compose-up"; then
  ej docker compose config --quiet "&& echo 'docker compose config: OK'"
  ej "docker compose up --build -d --wait 2>&1 | tail -n 12"
  ej "docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'"
  ej "docker network ls --filter name=torque --format '{{.Name}} internal={{.Internal}}'"
  ej "docker volume ls --filter name=torque --format '{{.Name}}'"
fi

# ------------------------------------------------------------------ 03 health
if seccion "03-health"; then
  ej "curl -s -w '\nHTTP %{http_code}' $GW/health"
  ej "curl -s -w '\nHTTP %{http_code}' $GW/health/servicios"
  nota "Health interno de cada servicio (desde su propio contenedor, puerto interno 3000):"
  for s in vehicles-service inventory-service workorders-service; do
    ej "docker compose exec -T $s node -e \"fetch('http://127.0.0.1:3000/health').then(r=>r.text()).then(console.log)\""
  done
  ej "docker inspect --format '{{.Name}} {{.State.Health.Status}}' \$(docker compose ps -q)"
fi

# ------------------------------------------------------------------ 04 crud
if seccion "04-crud"; then
  bash scripts/reset-datos.sh >/dev/null
  docker compose exec -T vehicles-db mongosh vehicles --quiet --eval 'db.vehiculos.deleteMany({patente: "AE111ZZ"})' >/dev/null
  nota "Vehículos (vehicles-service vía gateway)"
  ej req GET /api/vehiculos
  ej req POST /api/vehiculos "'{\"marca\":\"Fiat\",\"modelo\":\"Cronos\",\"anio\":2022,\"patente\":\"AE111ZZ\",\"kilometraje\":15000,\"duenio\":{\"nombre\":\"Pedro Díaz\",\"telefono\":\"261 555-0199\"}}'"
  ID=$(curl -s "$GW/api/vehiculos" | grep -o '"id":"[^"]*","marca":"Fiat"' | head -1 | cut -d'"' -f4)
  ej req GET "/api/vehiculos/$ID"
  ej req PUT "/api/vehiculos/$ID" "'{\"marca\":\"Fiat\",\"modelo\":\"Cronos\",\"anio\":2022,\"patente\":\"AE111ZZ\",\"kilometraje\":20000,\"duenio\":{\"nombre\":\"Pedro Díaz\",\"telefono\":\"261 555-0199\"}}'"
  ej req POST /api/vehiculos "'{\"marca\":\"Fiat\",\"modelo\":\"Uno\",\"anio\":2010,\"patente\":\"AE111ZZ\",\"kilometraje\":1,\"duenio\":{\"nombre\":\"Pedro Díaz\",\"telefono\":\"261 555-0199\"}}'"
  ej req POST /api/vehiculos "'{\"marca\":\"\",\"anio\":1800}'"
  ej req GET /api/vehiculos/68c000000000000000000099
  ej req DELETE "/api/vehiculos/$ID"
  nota "Repuestos (inventory-service vía gateway) — lock Redis del TP2"
  ej req GET /api/repuestos
  ej req POST "/api/repuestos/$REP_PASTILLAS/descontar" "'{\"cantidad\":1,\"ordenId\":\"6730a1b2c3d4e5f600000001\"}'"
  nota "Carrera sin lock: dos descuentos simultáneos sobre stock 1 → stock -1"
  bash scripts/reset-datos.sh >/dev/null
  ej "(req POST /api/repuestos/$REP_FILTRO/descontar-sin-lock & req POST /api/repuestos/$REP_FILTRO/descontar-sin-lock; wait)"
  ej req GET "/api/repuestos/$REP_FILTRO"
  nota "Con lock: uno 200, el otro 409 (recurso ocupado) → stock 0"
  bash scripts/reset-datos.sh >/dev/null
  ej "(req POST /api/repuestos/$REP_FILTRO/descontar '{\"ordenId\":\"6730a1b2c3d4e5f600000002\"}' & sleep 0.3; req POST /api/repuestos/$REP_FILTRO/descontar '{\"ordenId\":\"6730a1b2c3d4e5f600000003\"}'; wait)"
  ej req GET "/api/repuestos/$REP_FILTRO"
fi

# ------------------------------------------------------------------ 05 comunicación
if seccion "05-comunicacion"; then
  bash scripts/reset-datos.sh >/dev/null
  nota "workorders-service consulta vehicles-service e inventory-service por HTTP."
  RID="tp6-comunicacion-$(date +%s)"
  ej "curl -s -X POST $GW/api/ordenes -H '$JSON' -H 'x-request-id: $RID' -d '{\"vehiculoId\":\"$VEH_COROLLA\",\"descripcion\":\"Cambio de pastillas delanteras\",\"repuestos\":[{\"repuestoId\":\"$REP_PASTILLAS\",\"cantidad\":2}]}' -w '\nHTTP %{http_code}'"
  ej req GET "/api/repuestos/$REP_PASTILLAS"
  nota "Mismo request id en los logs de los 4 servicios (gateway → workorders → vehicles / inventory):"
  sleep 1
  ej "docker compose logs --no-color api-gateway workorders-service vehicles-service inventory-service | grep '$RID' | sort -k3"
  ej req POST /api/ordenes "'{\"vehiculoId\":\"68c000000000000000000099\",\"descripcion\":\"Vehiculo inexistente\",\"repuestos\":[]}'"
  ej req POST /api/ordenes "'{\"vehiculoId\":\"$VEH_COROLLA\",\"descripcion\":\"Repuesto inexistente\",\"repuestos\":[{\"repuestoId\":\"68c000000000000000000099\"}]}'"
  ej req GET /api/ordenes
fi

# ------------------------------------------------------------------ 06 propiedad de datos
if seccion "06-propiedad-datos"; then
  nota "Cada base solo contiene las colecciones de su servicio:"
  for par in vehicles-db:vehicles inventory-db:inventory workorders-db:workorders; do
    db="${par%%:*}"; nombre="${par##*:}"
    ej "docker compose exec -T $db mongosh --quiet $nombre --eval 'JSON.stringify({db: db.getName(), colecciones: db.getCollectionNames()})'"
  done
  nota "Cada servicio solo conoce SU base; workorders conoce a los otros por URL HTTP, no por Mongo:"
  for s in vehicles-service inventory-service workorders-service api-gateway; do
    ej "docker compose exec -T $s sh -c 'env | grep -E \"MONGODB_URI|REDIS_URL|_SERVICE_URL\" | sort'"
  done
  nota "La orden guarda solo referencias lógicas (ids) + copia de patente/código:"
  ej "docker compose exec -T workorders-db mongosh --quiet workorders --eval 'JSON.stringify(db.ordenes.findOne({}, {vehiculoId:1, patente:1, \"items.repuestoId\":1, \"items.codigo\":1, estado:1}))'"
fi

# ------------------------------------------------------------------ 07 persistencia
if seccion "07-persistencia"; then
  docker compose exec -T vehicles-db mongosh vehicles --quiet --eval 'db.vehiculos.deleteMany({patente: "AF208PP"})' >/dev/null
  ej req POST /api/vehiculos "'{\"marca\":\"Peugeot\",\"modelo\":\"208\",\"anio\":2023,\"patente\":\"AF208PP\",\"kilometraje\":5000,\"duenio\":{\"nombre\":\"Pedro Díaz\",\"telefono\":\"261 555-0199\"}}'"
  nota "docker compose down (SIN -v): se eliminan los contenedores, los volúmenes quedan"
  ej "docker compose down 2>&1 | tail -n 3"
  ej "docker volume ls --filter name=torque --format '{{.Name}}'"
  ej "docker compose up -d --wait 2>&1 | tail -n 2"
  ej "curl -s $GW/api/vehiculos | grep -o '\"patente\":\"AF208PP\"[^}]*' || echo 'NO ENCONTRADO'"
  ej "curl -s $GW/api/ordenes | grep -o -E '\"estado\":\"(EN_PROCESO|FINALIZADA|CANCELADA|FALLIDA|PENDIENTE)\",\"items' | sort | uniq -c"
  nota "Contenedores nuevos (otro ID), mismos datos. 'docker compose down -v' sí los borraría."
fi

# ------------------------------------------------------------------ 08 fallo de dependencia
if seccion "08-fallo-dependencia"; then
  bash scripts/reset-datos.sh >/dev/null
  ORDEN="'{\"vehiculoId\":\"$VEH_RANGER\",\"descripcion\":\"Cambio de bujias\",\"repuestos\":[{\"repuestoId\":\"$REP_BUJIAS\",\"cantidad\":4}]}'"
  nota "1) Solución completa: el caso de uso funciona"
  ej req POST /api/ordenes "$ORDEN"
  nota "2) Se detiene SOLO inventory-service (destino)"
  ej docker compose stop inventory-service
  nota "3) Se repite la operación desde workorders-service (origen) → 503 controlado, no 500"
  ej req POST /api/ordenes "$ORDEN"
  ej req GET /api/repuestos
  nota "4) El origen y el resto siguen vivos"
  ej "docker compose ps --format '{{.Service}}: {{.Status}}' workorders-service vehicles-service api-gateway inventory-service"
  ej req GET /api/vehiculos/$VEH_RANGER
  ej "curl -s -w '\nHTTP %{http_code}' $GW/health/servicios"
  ej "docker compose logs --no-color --since 30s workorders-service api-gateway | grep -E 'ERROR' | tail -n 6"
  nota "5) Se reinicia el destino y el caso de uso se recupera"
  ej "docker compose start inventory-service"
  esperar_sano inventory-service
  ej req POST /api/ordenes "$ORDEN"
  nota "Extra — base caída: vehicles-db detenida → vehicles-service responde 503 (no se cae) y se recupera"
  ej docker compose stop vehicles-db
  ej req GET /api/vehiculos
  ej "curl -s -w '\nHTTP %{http_code}' $GW/health/servicios"
  ej docker compose start vehicles-db
  esperar_sano vehicles-db vehicles-service
  ej "req GET /api/vehiculos/$VEH_RANGER"
fi

# ------------------------------------------------------------------ 09 fallo parcial
if seccion "09-fallo-parcial"; then
  bash scripts/reset-datos.sh >/dev/null
  nota "Stock semilla: filtro=1, pastillas=4, bujías=8. Se agota el filtro con una orden previa."
  ej req POST /api/ordenes "'{\"vehiculoId\":\"$VEH_COROLLA\",\"descripcion\":\"Cambio de aceite\",\"repuestos\":[{\"repuestoId\":\"$REP_FILTRO\",\"cantidad\":1}]}'"
  nota "Orden con 3 ítems: bujías (OK) → filtro (409 sin stock) → pastillas (no se intenta)"
  ej req POST /api/ordenes "'{\"vehiculoId\":\"$VEH_RANGER\",\"descripcion\":\"Service completo\",\"repuestos\":[{\"repuestoId\":\"$REP_BUJIAS\",\"cantidad\":4},{\"repuestoId\":\"$REP_FILTRO\",\"cantidad\":1},{\"repuestoId\":\"$REP_PASTILLAS\",\"cantidad\":1}]}'"
  nota "Estado parcial: las bujías YA se descontaron en inventory aunque la orden falló"
  ej req GET /api/repuestos
  ej "curl -s '$GW/api/ordenes?estado=FALLIDA' | grep -o '\"requiereCompensacion\":[a-z]*' | sort | uniq -c"
  ej "docker compose logs --no-color --since 20s workorders-service | grep 'FALLO PARCIAL'"
  nota "Variante timeout: inventory tarda más que el timeout de workorders → ítem INCIERTO"
  ej "INVENTORY_TIMEOUT_MS=500 docker compose up -d --wait workorders-service 2>&1 | tail -n 1"
  bash scripts/reset-datos.sh >/dev/null
  ej req POST /api/ordenes "'{\"vehiculoId\":\"$VEH_RANGER\",\"descripcion\":\"Timeout demo\",\"repuestos\":[{\"repuestoId\":\"$REP_BUJIAS\",\"cantidad\":1}]}'"
  sleep 2
  nota "workorders dice INCIERTO, pero inventory sí descontó (8 → 7):"
  ej req GET "/api/repuestos/$REP_BUJIAS"
  ej "docker compose up -d --wait workorders-service 2>&1 | tail -n 1"
fi

# ------------------------------------------------------------------ 10 logs
if seccion "10-logs"; then
  ej "docker compose logs --no-color --tail 4 vehicles-service inventory-service workorders-service api-gateway"
  ej "docker compose logs --no-color inventory-service | grep -E 'WARN|ERROR' | tail -n 5"
fi

# ------------------------------------------------------------------ 11 swagger
if seccion "11-swagger"; then
  ej "curl -s $GW/api-docs/ | grep -o '<title>[^<]*</title>'"
  for s in vehicles inventory workorders gateway; do
    ej "curl -s $GW/api-docs/$s.json | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.info.title, Object.entries(j.paths).map(([p,o])=>Object.keys(o).filter(k=>k!=='parameters').map(m=>m.toUpperCase()+' '+p).join(', ')).join(' | '))})\""
  done
fi

# ------------------------------------------------------------------ 12 datos de prueba
if seccion "12-datos-prueba"; then
  nota "Reset parcial (solo stock) — entre pruebas:"
  ej bash scripts/reset-datos.sh
  nota "Reset total (borra volúmenes y vuelve a sembrar):"
  ej "bash scripts/reset-datos.sh --todo 2>&1 | tail -n 2"
  ej "curl -s $GW/api/vehiculos | grep -o '\"patente\":\"[A-Z0-9]*\"'"
  ej "curl -s $GW/api/repuestos | grep -o '\"codigo\":\"[A-Z0-9-]*\",\"stock\":[0-9-]*'"
  ej "curl -s $GW/api/ordenes"
fi

echo; echo "Evidencias en $EVID/"
