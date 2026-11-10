#!/usr/bin/env bash
# Pruebas de las correcciones de la primera revisión (docs/correcciones/).
# Requiere Docker, curl, node y bash. Cada sección deja su salida en
# docs/correcciones/evidencias/.
#
#   LAB_ENDPOINTS=true docker compose up --build -d --wait   (la carrera de stock usa el laboratorio)
#   bash scripts/pruebas-correcciones.sh            → todas las secciones
#   bash scripts/pruebas-correcciones.sh 07-        → solo las que empiezan así
#
# Convención de la evidencia:
#   pedir "$TOKEN" MÉTODO RUTA [BODY]  =  curl -X MÉTODO $GW$RUTA -H "Authorization: Bearer $TOKEN" [-d BODY]
#   (pedir "" ... = sin header Authorization)
# Los tokens nunca se imprimen completos. La contraseña del admin sale de .env.
set -uo pipefail
cd "$(dirname "$0")/.."

GW="${GW:-http://localhost:3000}"
EVID="docs/correcciones/evidencias"
FILTRO="${1:-}"
JSON='content-type: application/json'
mkdir -p "$EVID"

VEH_COROLLA=68c000000000000000000001
VEH_RANGER=68c000000000000000000002
REP_FILTRO=68c000000000000000000011
REP_PASTILLAS=68c000000000000000000012
REP_BUJIAS=68c000000000000000000013
PASS_MEC='clave-de-prueba-1'
MEC1=mecanico1@torque.local
MEC2=mecanico2@torque.local

[ -f .env ] || bash scripts/generar-env.sh
set -a; . ./.env; set +a
# Estas pruebas usan los endpoints de laboratorio (reiniciar / carrera): se
# fuerzan acá porque .env los deja apagados (LAB_ENDPOINTS=false).
export LAB_ENDPOINTS=true

# ------------------------------------------------------------------ helpers
seccion() {
  ACTUAL="$1"
  if [ -n "$FILTRO" ] && [[ "$ACTUAL" != "$FILTRO"* ]]; then return 1; fi
  : > "$EVID/$ACTUAL.txt"
  echo; echo "################ $ACTUAL"
  return 0
}
ej() { { echo; echo "\$ $*"; eval "$@" 2>&1; echo; } | tee -a "$EVID/$ACTUAL.txt"; }
nota() { echo "# $*" | tee -a "$EVID/$ACTUAL.txt"; }

# Oculta tokens en cualquier salida JSON (primeros 16 caracteres).
ocultar() { sed -E 's/("(accessToken|refreshToken)":")([^"]{16})[^"]*"/\1\3…(oculto)"/g'; }

pedir() { # pedir TOKEN MÉTODO RUTA [BODY] → cuerpo + "HTTP nnn"
  local t="$1" m="$2" r="$3" b="${4:-}" auth=()
  [ -n "$t" ] && auth=(-H "Authorization: Bearer $t")
  if [ -n "$b" ]; then curl -s -X "$m" "$GW$r" "${auth[@]}" -H "$JSON" -d "$b" -w '\nHTTP %{http_code}'
  else curl -s -X "$m" "$GW$r" "${auth[@]}" -w '\nHTTP %{http_code}'; fi | ocultar
  echo
}
# Igual que pedir, pero el cuerpo JSON se resume con un filtro de node:
#   ver TOKEN MÉTODO RUTA BODY 'expr'   (expr usa `j` = cuerpo parseado)
ver() {
  local t="$1" m="$2" r="$3" b="$4" expr="$5" auth=()
  [ -n "$t" ] && auth=(-H "Authorization: Bearer $t")
  local salida
  if [ -n "$b" ]; then salida=$(curl -s -X "$m" "$GW$r" "${auth[@]}" -H "$JSON" -d "$b" -w '\nHTTP %{http_code}')
  else salida=$(curl -s -X "$m" "$GW$r" "${auth[@]}" -w '\nHTTP %{http_code}'); fi
  printf '%s' "$salida" | node -e "
    let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
      const i=d.lastIndexOf('\nHTTP '); const cuerpo=d.slice(0,i); const st=d.slice(i+1);
      let j=null; try{j=JSON.parse(cuerpo)}catch{}
      let r; try{r=($expr)}catch(e){r=cuerpo}
      console.log(typeof r==='string'?r:JSON.stringify(r,null,2)); console.log(st);
    })"
}
campo() { # campo EXPR < json → valor (j = cuerpo parseado)
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=d.split('\nHTTP')[0];try{const j=JSON.parse(t);const v=($1);process.stdout.write(v===undefined||v===null?'':String(v))}catch{}})"
}
login() { # login EMAIL PASSWORD → JSON completo del login (sin imprimir)
  curl -s -X POST "$GW/api/auth/login" -H "$JSON" -d "{\"email\":\"$1\",\"password\":\"$2\"}"
}
token_de() { login "$1" "$2" | campo 'j.accessToken'; }
decodificar() {
  node -e '
    const [h, p] = process.argv[1].split(".");
    const pl = JSON.parse(Buffer.from(p, "base64url").toString());
    console.log("payload:", JSON.stringify(pl));
    console.log("vigencia:", pl.exp - pl.iat, "s  (exp", new Date(pl.exp * 1000).toISOString() + ")");
  ' "$1"
}
esperar_sano() {
  for s in "$@"; do
    for _ in $(seq 1 60); do
      id=$(docker compose ps -q "$s")
      [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)" = "healthy" ] && break
      sleep 2
    done
  done
}
stock() { pedir "$T_ADMIN" GET /api/repuestos | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{for(const r of JSON.parse(d.split('\nHTTP')[0]))console.log(r.codigo.padEnd(12), 'stock', r.stock)})"; }
libro() { # libro QUERY → movimientos resumidos
  pedir "$T_ADMIN" GET "/api/repuestos/movimientos?$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const m=JSON.parse(d.split('\nHTTP')[0]).reverse();
    for(const x of m)console.log(x.tipo.padEnd(10), x.codigo.padEnd(12), String(x.cantidad>0?'+'+x.cantidad:x.cantidad).padStart(4), ' ', x.stockAnterior,'→',x.stockResultante, ' orden='+(x.ordenId||'-'), ' usuario='+(x.usuario===USR.admin?'ADMIN':x.usuario===USR.mec1?'mecanico1':x.usuario===USR.mec2?'mecanico2':x.usuario), x.motivo?' «'+x.motivo+'»':'');
  })"
}
resumen_orden='({estado:j.estado||(j.orden&&j.orden.estado), error:j.error, detalles:j.detalles, items:(j.items||(j.orden&&j.orden.items)||[]).map(i=>i.codigo+" x"+i.cantidad+" "+i.estado), cancelacion:j.cancelacion, reposicion:j.reposicion||(j.orden&&j.orden.reposicion), historial:(j.historial||(j.orden&&j.orden.historial)||[]).map(h=>h.estado+(h.detalle?" («"+h.detalle+"»)":""))})'

asegurar_usuarios() { # crea los mecánicos de prueba si no existen (alta administrada, idempotente)
  T_ADMIN=$(token_de "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
  for u in "$MEC1:Mecanico Uno" "$MEC2:Mecanico Dos"; do
    curl -s -o /dev/null -X POST "$GW/api/auth/usuarios" -H "$JSON" -H "Authorization: Bearer $T_ADMIN" \
      -d "{\"email\":\"${u%%:*}\",\"nombre\":\"${u#*:}\",\"password\":\"$PASS_MEC\"}"
  done
  T_MEC1=$(token_de "$MEC1" "$PASS_MEC")
  T_MEC2=$(token_de "$MEC2" "$PASS_MEC")
  export USR_JSON
  USR_JSON=$(node -e 'const s=t=>JSON.parse(Buffer.from(t.split(".")[1],"base64url")).sub;console.log(JSON.stringify({admin:s(process.argv[1]),mec1:s(process.argv[2]),mec2:s(process.argv[3])}))' "$T_ADMIN" "$T_MEC1" "$T_MEC2")
  export NODE_OPTIONS="--require $PWD/scripts/.usr.cjs"
  echo "global.USR=JSON.parse(process.env.USR_JSON||'{}')" > scripts/.usr.cjs
}
reiniciar_stock() { curl -s -o /dev/null -X POST "$GW/api/repuestos/reiniciar" -H "Authorization: Bearer $T_ADMIN"; }
trap 'rm -f scripts/.usr.cjs' EXIT

# ------------------------------------------------------------------ 00 arranque
if seccion "00-arranque"; then
  nota "Solución levantada con un solo comando. LAB_ENDPOINTS=true solo para la demo de carrera (sección 10)."
  ej "docker compose ps --format '{{.Service}}\t{{.Status}}' | sort"
  ej "curl -s $GW/health/servicios | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.status);for(const[k,v]of Object.entries(j.servicios))console.log(' ',k.padEnd(20),v.status,JSON.stringify(v.dependencias||{}))})\""
fi

# ------------------------------------------------------------------ 01 alta administrada
if seccion "01-alta-administrada"; then
  nota "Requisito 1: no hay registro abierto. El ADMIN da de alta a los mecánicos."
  nota "Estado inicial: solo el admin (se borran usuarios y sesiones de corridas anteriores)."
  ej "docker compose exec -T auth-db mongosh auth --quiet --eval 'db.sesiones.deleteMany({}); db.usuarios.deleteMany({rol: \"MECANICO\"}).deletedCount'"
  nota "El registro público ya no existe → 404"
  ej "pedir '' POST /api/auth/register '{\"email\":\"$MEC1\",\"nombre\":\"Mecanico Uno\",\"password\":\"$PASS_MEC\"}'"
  nota "Alta sin token → 401"
  ej "pedir '' POST /api/auth/usuarios '{\"email\":\"$MEC1\",\"nombre\":\"Mecanico Uno\",\"password\":\"$PASS_MEC\"}'"
  T_ADMIN=$(token_de "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
  nota "ADMIN crea dos mecánicos → 201 (la respuesta no incluye contraseña ni hash)"
  ej 'pedir "$T_ADMIN" POST /api/auth/usuarios "{\"email\":\"$MEC1\",\"nombre\":\"Mecanico Uno\",\"password\":\"$PASS_MEC\"}"'
  ej 'pedir "$T_ADMIN" POST /api/auth/usuarios "{\"email\":\"$MEC2\",\"nombre\":\"Mecanico Dos\",\"password\":\"$PASS_MEC\"}"'
  nota "Validación (400) y duplicado, también con otra capitalización (409)"
  ej 'pedir "$T_ADMIN" POST /api/auth/usuarios "{\"email\":\"no-es-email\",\"nombre\":\"X\",\"password\":\"corta\"}"'
  ej 'pedir "$T_ADMIN" POST /api/auth/usuarios "{\"email\":\"MECANICO1@torque.local\",\"nombre\":\"Otro\",\"password\":\"$PASS_MEC\"}"'
  T_MEC1=$(token_de "$MEC1" "$PASS_MEC")
  nota "Un MECANICO no puede dar de alta usuarios → 403"
  ej 'pedir "$T_MEC1" POST /api/auth/usuarios "{\"email\":\"intruso@torque.local\",\"nombre\":\"Intruso\",\"password\":\"$PASS_MEC\",\"rol\":\"ADMIN\"}"'
  nota "El mecánico creado por el admin inicia sesión normalmente:"
  ej 'pedir "" POST /api/auth/login "{\"email\":\"$MEC1\",\"password\":\"$PASS_MEC\"}"'
fi

# ------------------------------------------------------------------ 02 sesión renovable
if seccion "02-sesion-renovable"; then
  asegurar_usuarios
  nota "Requisito 3: access token de 5 minutos + refresh token rotativo; vence a los 15 min sin uso; logout revoca."
  L=$(login "$MEC1" "$PASS_MEC")
  A1=$(printf '%s' "$L" | campo 'j.accessToken'); R1=$(printf '%s' "$L" | campo 'j.refreshToken')
  ej 'printf "%s" "$L" | ocultar | node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>{const j=JSON.parse(d);delete j.usuario;console.log(j)})"'
  ej 'decodificar "$A1"'
  nota "Renovación con R1: access nuevo + refresh nuevo R2 (R1 se rota y deja de servir)"
  OUT=$(curl -s -X POST "$GW/api/auth/refresh" -H "$JSON" -d "{\"refreshToken\":\"$R1\"}" -w '\nHTTP %{http_code}')
  R2=$(printf '%s' "$OUT" | campo 'j.refreshToken')
  ej 'printf "%s\n" "$OUT" | ocultar'
  nota "Reusar R1 (ya rotado) → 401 y se revoca la sesión entera (posible robo del refresh token)"
  ej 'pedir "" POST /api/auth/refresh "{\"refreshToken\":\"$R1\"}"'
  nota "…por eso tampoco sirve el último refresh de esa sesión (protección ante robo):"
  ej 'pedir "" POST /api/auth/refresh "{\"refreshToken\":\"$R2\"}"'

  nota "Logout: nueva sesión, se cierra y el refresh queda cancelado → 401"
  L=$(login "$MEC1" "$PASS_MEC")
  A3=$(printf '%s' "$L" | campo 'j.accessToken'); R3=$(printf '%s' "$L" | campo 'j.refreshToken')
  ej 'pedir "" POST /api/auth/logout "{\"refreshToken\":\"$R3\"}"'
  ej 'pedir "" POST /api/auth/refresh "{\"refreshToken\":\"$R3\"}"'
  nota "El access token ya emitido sigue valiendo hasta su exp (≤ 5 min): se verifica solo con la firma, sin consultar a auth."
  ej 'pedir "$A3" GET /api/auth/me | tail -n 1'

  nota "Inactividad: se reinicia SOLO auth-service con SESSION_IDLE=8s (configuración externa)."
  ej "SESSION_IDLE=8s docker compose up -d --wait auth-service 2>&1 | tail -n 1"
  L=$(login "$MEC1" "$PASS_MEC"); R4=$(printf '%s' "$L" | campo 'j.refreshToken')
  nota "Uso continuo: renovar a los 5 s mantiene viva la sesión (cada renovación corre el plazo)…"
  sleep 5
  R5=$(curl -s -X POST "$GW/api/auth/refresh" -H "$JSON" -d "{\"refreshToken\":\"$R4\"}" | campo 'j.refreshToken')
  ej 'echo "renovado a los 5 s: ${R5:0:16}…(oculto)"'
  sleep 5
  ej 'pedir "" POST /api/auth/refresh "{\"refreshToken\":\"$R5\"}" | tail -n 1'
  L=$(login "$MEC1" "$PASS_MEC"); R7=$(printf '%s' "$L" | campo 'j.refreshToken')
  nota "…y sin usarla 10 s (> 8 s) la sesión vence por inactividad:"
  sleep 10
  ej 'pedir "" POST /api/auth/refresh "{\"refreshToken\":\"$R7\"}"'
  ej "docker compose logs --no-color --since 40s auth-service | grep -E 'renovada|inactividad|reutilizado|Logout' | cut -d'|' -f2- | cut -c1-170 | tail -n 6"
  nota "Se restaura la configuración normal."
  ej "docker compose up -d --wait auth-service 2>&1 | tail -n 1"
  nota "Deshabilitar un usuario revoca sus sesiones:"
  L=$(login "$MEC2" "$PASS_MEC"); R8=$(printf '%s' "$L" | campo 'j.refreshToken')
  T_ADMIN=$(token_de "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
  ID_MEC2=$(printf '%s' "$L" | campo 'j.usuario.id')
  ej 'pedir "$T_ADMIN" PATCH /api/auth/usuarios/$ID_MEC2 "{\"activo\":false}" | tail -n 1'
  ej 'pedir "" POST /api/auth/refresh "{\"refreshToken\":\"$R8\"}"'
  ej 'pedir "$T_ADMIN" PATCH /api/auth/usuarios/$ID_MEC2 "{\"activo\":true}" | tail -n 1'
  ej "docker compose exec -T auth-db mongosh auth --quiet --eval 'db.sesiones.aggregate([{\$group:{_id:\"\$motivoRevocacion\",n:{\$sum:1}}}]).toArray()'"
  nota "En la base se guarda solo el hash del refresh token, nunca el valor:"
  ej "docker compose exec -T auth-db mongosh auth --quiet --eval 'db.sesiones.findOne({}, {_id:0, tokenHash:1, ultimoUso:1, expiraEn:1, renovaciones:1, revocadaEn:1, motivoRevocacion:1})'"
fi

# ------------------------------------------------------------------ 03 vehículos
if seccion "03-vehiculos"; then
  asegurar_usuarios
  nota "Requisito 4: dueño obligatorio, duplicado detectado, baja lógica e historial."
  ej "docker compose exec -T vehicles-db mongosh vehicles --quiet --eval 'db.vehiculos.deleteMany({patente: \"AE001ZZ\"}).deletedCount'"
  nota "Alta sin datos del dueño → 400"
  ej 'pedir "$T_MEC1" POST /api/vehiculos "{\"marca\":\"Fiat\",\"modelo\":\"Cronos\",\"anio\":2022,\"patente\":\"AE001ZZ\",\"kilometraje\":15000}"'
  nota "Alta completa por un MECANICO → 201"
  ej 'pedir "$T_MEC1" POST /api/vehiculos "{\"marca\":\"Fiat\",\"modelo\":\"Cronos\",\"anio\":2022,\"patente\":\"AE001ZZ\",\"kilometraje\":15000,\"duenio\":{\"nombre\":\"Pedro Díaz\",\"telefono\":\"261 555-0199\"}}"'
  VEH_NUEVO=$(pedir "$T_MEC1" GET /api/vehiculos/patente/AE001ZZ | campo 'j.id')
  nota "Mismo auto otra vez (la patente con guion y minúsculas se normaliza) → 409 con el vehículo existente, no se duplica"
  ej 'pedir "$T_MEC2" POST /api/vehiculos "{\"marca\":\"Fiat\",\"modelo\":\"Cronos\",\"anio\":2022,\"patente\":\"ae-001zz\",\"kilometraje\":16000,\"duenio\":{\"nombre\":\"Pedro Díaz\",\"telefono\":\"261 555-0199\"}}"'
  nota "Se usa el existente para la orden nueva: alcanza con la patente"
  ej "ver \"\$T_MEC2\" POST /api/ordenes '{\"patente\":\"AE001ZZ\",\"descripcion\":\"Revisión de frenos\"}' '({id:j.id, vehiculoId:j.vehiculoId, patente:j.patente, estado:j.estado})'"
  nota "Baja: MECANICO → 403 · ADMIN → 200, baja LÓGICA (activo:false, quién, cuándo, motivo)"
  ej 'pedir "$T_MEC1" DELETE /api/vehiculos/$VEH_NUEVO | tail -n 1'
  ej 'pedir "$T_ADMIN" DELETE /api/vehiculos/$VEH_NUEVO "{\"motivo\":\"El dueño vendió el auto\"}"'
  nota "El auto sigue en la base, no aparece en el listado de activos y no admite órdenes nuevas (409):"
  ej "docker compose exec -T vehicles-db mongosh vehicles --quiet --eval 'db.vehiculos.findOne({patente: \"AE001ZZ\"}, {_id:0, patente:1, activo:1, baja:1, duenio:1})'"
  ej "pedir \"\$T_MEC1\" GET /api/vehiculos | grep -c AE001ZZ || true"
  ej "pedir \"\$T_MEC1\" GET '/api/vehiculos?incluirInactivos=true' | grep -c AE001ZZ || true"
  ej 'pedir "$T_MEC1" POST /api/ordenes "{\"vehiculoId\":\"$VEH_NUEVO\",\"descripcion\":\"Cambio de aceite\"}"'
  nota "Su historial se conserva (la orden previa sigue apuntando a un auto que existe):"
  ej "ver \"\$T_MEC1\" GET /api/ordenes/vehiculo/\$VEH_NUEVO '' '({patente:j.patente, ordenes:j.ordenes.map(o=>o.descripcion+\" · \"+o.estado)})'"
  nota "Modificar un vehículo inactivo → 409; ADMIN lo reactiva → 200"
  ej 'pedir "$T_MEC1" PUT /api/vehiculos/$VEH_NUEVO "{\"marca\":\"Fiat\",\"modelo\":\"Cronos\",\"anio\":2022,\"patente\":\"AE001ZZ\",\"kilometraje\":20000,\"duenio\":{\"nombre\":\"Pedro Díaz\",\"telefono\":\"261 555-0199\"}}" | tail -n 2'
  ej 'pedir "$T_ADMIN" POST /api/vehiculos/$VEH_NUEVO/reactivar | tail -n 1'
fi

# ------------------------------------------------------------------ 04 consulta de stock
if seccion "04-stock-autenticado"; then
  asegurar_usuarios
  nota "Requisito 5: el stock es información interna → la consulta requiere estar autenticado"
  ej "pedir '' GET /api/repuestos"
  ej "pedir '' GET /api/repuestos/$REP_BUJIAS"
  ej 'pedir "$T_MEC1" GET /api/repuestos/$REP_BUJIAS'
fi

# ------------------------------------------------------------------ 05 inventario
if seccion "05-inventario-alta-ingreso-ajuste"; then
  asegurar_usuarios
  ej "docker compose exec -T inventory-db mongosh inventory --quiet --eval 'db.repuestos.deleteMany({codigo: \"RAD-COR-001\"}); db.movimientos.deleteMany({codigo: \"RAD-COR-001\"}).deletedCount'"
  nota "Requisito 6: alta de repuesto, solo ADMIN, código único"
  ej 'pedir "$T_MEC1" POST /api/repuestos "{\"nombre\":\"Radiador Corolla\",\"codigo\":\"RAD-COR-001\",\"stock\":2}" | tail -n 2'
  ej 'pedir "$T_ADMIN" POST /api/repuestos "{\"nombre\":\"Radiador Corolla\",\"codigo\":\"RAD-COR-001\",\"stock\":2}"'
  REP_RAD=$(pedir "$T_ADMIN" GET /api/repuestos | campo 'j.find(r=>r.codigo==="RAD-COR-001").id')
  ej 'pedir "$T_ADMIN" POST /api/repuestos "{\"nombre\":\"Otro radiador\",\"codigo\":\"rad-cor-001\"}"'
  nota "Requisito 7: ingreso (suma mercadería) y ajuste (corrige un conteo, exige motivo): dos operaciones distintas, solo ADMIN"
  ej 'pedir "$T_MEC1" POST /api/repuestos/$REP_RAD/ingreso "{\"cantidad\":5}" | tail -n 1'
  ej "ver \"\$T_ADMIN\" POST /api/repuestos/\$REP_RAD/ingreso '{\"cantidad\":5,\"motivo\":\"Remito 0001-00012345\"}' '({item:j.item, movimiento:{tipo:j.movimiento.tipo,cantidad:j.movimiento.cantidad,stock:j.movimiento.stockAnterior+\" → \"+j.movimiento.stockResultante,motivo:j.movimiento.motivo}})'"
  nota "Ajuste sin motivo → 400"
  ej 'pedir "$T_ADMIN" POST /api/repuestos/$REP_RAD/ajuste "{\"cantidad\":-1}"'
  ej "ver \"\$T_ADMIN\" POST /api/repuestos/\$REP_RAD/ajuste '{\"cantidad\":-1,\"motivo\":\"Conteo físico: una unidad golpeada\"}' '({item:j.item, movimiento:{tipo:j.movimiento.tipo,cantidad:j.movimiento.cantidad,stock:j.movimiento.stockAnterior+\" → \"+j.movimiento.stockResultante,motivo:j.movimiento.motivo}})'"
  nota "Un ajuste que dejaría el stock negativo → 409"
  ej 'pedir "$T_ADMIN" POST /api/repuestos/$REP_RAD/ajuste "{\"cantidad\":-50,\"motivo\":\"Error de prueba\"}"'
  nota "Libro de movimientos del repuesto (requisito 9): tipo, cantidad, saldo, usuario y motivo"
  ej 'libro "repuestoId=$REP_RAD"'
fi

# ------------------------------------------------------------------ 07 cancelación + reposición
if seccion "06-cancelacion-y-reposicion"; then
  asegurar_usuarios
  reiniciar_stock
  nota "Requisitos 10 y 14. Stock inicial:"
  ej stock
  nota "MECANICO 1 crea una orden con 2 bujías y 1 juego de pastillas → 201 EN_PROCESO"
  O1=$(pedir "$T_MEC1" POST /api/ordenes "{\"vehiculoId\":\"$VEH_COROLLA\",\"descripcion\":\"Service de encendido y frenos\",\"repuestos\":[{\"repuestoId\":\"$REP_BUJIAS\",\"cantidad\":2},{\"repuestoId\":\"$REP_PASTILLAS\",\"cantidad\":1}]}" | campo 'j.id')
  ej "ver \"\$T_MEC1\" GET /api/ordenes/\$O1 '' '$resumen_orden'"
  ej stock
  nota "Otro mecánico no puede cancelarla → 403 · sin motivo → 400"
  ej 'pedir "$T_MEC2" POST /api/ordenes/$O1/cancelar "{\"motivo\":\"No es mía\"}" | tail -n 1'
  ej 'pedir "$T_MEC1" POST /api/ordenes/$O1/cancelar "{}"'
  nota "El dueño la cancela con motivo → CANCELADA, motivo/quién/cuándo, y el stock vuelve SOLO (reposición COMPLETA)"
  ej "ver \"\$T_MEC1\" POST /api/ordenes/\$O1/cancelar '{\"motivo\":\"El cliente decidió no hacer el trabajo\"}' '$resumen_orden'"
  ej stock
  nota "Libro de la orden: cada DESCUENTO tiene su REPOSICION (contramovimiento ligado a la misma orden, no rollback)"
  ej 'libro "ordenId=$O1"'
  nota "Cancelar dos veces → 409 (la orden queda en la base como CANCELADA)"
  ej 'pedir "$T_MEC1" POST /api/ordenes/$O1/cancelar "{\"motivo\":\"Otra vez\"}"'
  nota "La reposición es idempotente: pedirla de nuevo a inventory no vuelve a sumar"
  ej "ver \"\$T_MEC1\" POST /api/repuestos/reposiciones '{\"ordenId\":\"'\$O1'\"}' '({unidadesRepuestas:j.unidadesRepuestas, items:j.items.map(i=>i.codigo+\" \"+i.estado)})'"
  nota "El ADMIN también puede cancelar la orden de un mecánico:"
  O2=$(pedir "$T_MEC2" POST /api/ordenes "{\"vehiculoId\":\"$VEH_RANGER\",\"descripcion\":\"Cambio de pastillas\",\"repuestos\":[{\"repuestoId\":\"$REP_PASTILLAS\",\"cantidad\":2}]}" | campo 'j.id')
  ej "ver \"\$T_ADMIN\" POST /api/ordenes/\$O2/cancelar '{\"motivo\":\"Orden cargada por error\"}' '({estado:j.estado, cancelacion:j.cancelacion, reposicion:j.reposicion})'"
  ej stock
fi

# ------------------------------------------------------------------ 08 fallo parcial
if seccion "07-fallo-parcial-reposicion-automatica"; then
  asegurar_usuarios
  reiniciar_stock
  nota "El caso que antes quedaba trabado: bujías ya descontadas y sin stock del siguiente repuesto."
  ej stock
  nota "Orden: 4 bujías (hay 8) + 2 filtros (hay 1) → el filtro falla → FALLIDA y las bujías se reponen automáticamente"
  ej "ver \"\$T_MEC1\" POST /api/ordenes '{\"vehiculoId\":\"$VEH_RANGER\",\"descripcion\":\"Service completo\",\"repuestos\":[{\"repuestoId\":\"$REP_BUJIAS\",\"cantidad\":4},{\"repuestoId\":\"$REP_FILTRO\",\"cantidad\":2}]}' '$resumen_orden'"
  OF=$(pedir "$T_MEC1" GET "/api/ordenes?estado=FALLIDA" | campo 'j[0].id')
  ej stock
  ej 'libro "ordenId=$OF"'
  ej "docker compose logs --no-color --since 20s workorders-service | grep -E 'FALLIDA|reposición' | cut -d'|' -f2- | cut -c1-200"
fi

# ------------------------------------------------------------------ 09 estados
if seccion "08-estados-de-la-orden"; then
  asegurar_usuarios
  reiniciar_stock
  nota "Requisito 13: PENDIENTE → EN_PROCESO → FINALIZADA (además CANCELADA y FALLIDA)"
  OE=$(pedir "$T_MEC1" POST /api/ordenes "{\"vehiculoId\":\"$VEH_COROLLA\",\"descripcion\":\"Cambio de bujías\",\"repuestos\":[{\"repuestoId\":\"$REP_BUJIAS\",\"cantidad\":4}]}" | campo 'j.id')
  ej "ver \"\$T_MEC1\" GET /api/ordenes/\$OE '' '({estado:j.estado, historial:j.historial.map(h=>h.estado)})'"
  nota "Editar la descripción (dueño, orden abierta) → 200"
  ej "ver \"\$T_MEC1\" PATCH /api/ordenes/\$OE '{\"descripcion\":\"Cambio de bujías y cables\"}' '({descripcion:j.descripcion, estado:j.estado})'"
  nota "Otro mecánico no puede finalizarla → 403; el dueño sí → FINALIZADA"
  ej 'pedir "$T_MEC2" POST /api/ordenes/$OE/finalizar | tail -n 1'
  ej "ver \"\$T_MEC1\" POST /api/ordenes/\$OE/finalizar '' '({estado:j.estado, finalizacion:j.finalizacion?\"por \"+(j.finalizacion.por===USR.mec1?\"mecanico1\":j.finalizacion.por):null, historial:j.historial.map(h=>h.estado)})'"
  nota "Una orden FINALIZADA ya no se cancela (los repuestos se usaron) ni se edita → 409"
  ej 'pedir "$T_MEC1" POST /api/ordenes/$OE/cancelar "{\"motivo\":\"Me arrepentí\"}"'
  ej 'pedir "$T_MEC1" PATCH /api/ordenes/$OE "{\"descripcion\":\"Otra cosa\"}" | tail -n 1'
  ej stock
  nota "Filtros por los estados nuevos; un estado inexistente → 400"
  ej "ver \"\$T_ADMIN\" GET '/api/ordenes' '' 'Object.entries(j.reduce((a,o)=>(a[o.estado]=(a[o.estado]||0)+1,a),{})).map(([k,v])=>k+\": \"+v).join(\" · \")'"
  ej "pedir \"\$T_ADMIN\" GET '/api/ordenes?estado=CONFIRMADA'"
fi

# ------------------------------------------------------------------ 10 historial del vehículo
if seccion "09-historial-del-vehiculo"; then
  asegurar_usuarios
  nota "Cualquier mecánico ve TODAS las órdenes del auto, en solo lectura (propia = puede editarla/cancelarla)"
  ej "ver \"\$T_MEC2\" GET /api/ordenes/vehiculo/$VEH_COROLLA '' '({patente:j.patente, soloLectura:j.soloLectura, ordenes:j.ordenes.map(o=>o.estado.padEnd(11)+\" propia=\"+o.propia+\" · \"+o.descripcion)})'"
  OAJ=$(pedir "$T_MEC1" GET /api/ordenes | campo 'j.find(o=>o.vehiculoId==="'$VEH_COROLLA'"&&o.estado==="FINALIZADA").id')
  nota "…pero no puede operar sobre una orden ajena: cancelar → 403 (y su listado general sigue mostrando solo las propias)"
  ej 'pedir "$T_MEC2" POST /api/ordenes/$OAJ/cancelar "{\"motivo\":\"Prueba de propiedad\"}" | tail -n 1'
  ej "ver \"\$T_MEC2\" GET /api/ordenes '' 'j.every(o=>o.creadaPor===USR.mec2) ? \"todas propias (\"+j.length+\")\" : \"HAY AJENAS\"'"
fi

# ------------------------------------------------------------------ 11 carrera + laboratorio
if seccion "10-carrera-y-laboratorio"; then
  asegurar_usuarios
  reiniciar_stock
  nota "Requisito 8 (sin cambios): exclusión mutua con Redis; ahora además registra el movimiento."
  nota "Laboratorio activo (LAB_ENDPOINTS=true). Filtro de aceite con stock 1. Dos descuentos SIN lock a la vez:"
  ej "(pedir \"\$T_ADMIN\" POST /api/repuestos/$REP_FILTRO/descontar-sin-lock '{\"cantidad\":1}' | tail -n 1 & pedir \"\$T_ADMIN\" POST /api/repuestos/$REP_FILTRO/descontar-sin-lock '{\"cantidad\":1}' | tail -n 1; wait)"
  ej stock
  nota "Los dos pasaron el control con stock 1 (check-then-act sin lock). El libro registra el saldo real: el segundo lo dejó en -1"
  ej 'libro "repuestoId=$REP_FILTRO"'
  reiniciar_stock
  nota "Mismo par CON lock (camino de las órdenes, órdenes A y B; B llega 0,3 s después, con A dentro de la sección crítica): A 200, B 409"
  OA=6730a1b2c3d4e5f6000000a1; OB=6730a1b2c3d4e5f6000000b2
  ej "(pedir \"\$T_ADMIN\" POST /api/repuestos/$REP_FILTRO/descontar '{\"cantidad\":1,\"ordenId\":\"$OA\"}' | tail -n 1 & sleep 0.3; pedir \"\$T_ADMIN\" POST /api/repuestos/$REP_FILTRO/descontar '{\"cantidad\":1,\"ordenId\":\"$OB\"}' | tail -n 1; wait)"
  ej stock
  nota "Reintento del mismo descuento (misma orden, p. ej. después de un timeout): no descuenta dos veces"
  ej "ver \"\$T_ADMIN\" POST /api/repuestos/$REP_FILTRO/descontar '{\"cantidad\":1,\"ordenId\":\"$OA\"}' '({mensaje:j.mensaje, repetido:j.repetido, error:j.error})'"
  nota "Descuento tardío de una orden ya repuesta → 409 (orden cerrada)"
  pedir "$T_ADMIN" POST /api/repuestos/reposiciones "{\"ordenId\":\"$OB\",\"repuestoIds\":[\"$REP_FILTRO\"]}" >/dev/null
  ej "pedir \"\$T_ADMIN\" POST /api/repuestos/$REP_FILTRO/descontar '{\"cantidad\":1,\"ordenId\":\"$OB\"}'"
  reiniciar_stock
  nota "Requisito 16: sin la variable, los endpoints de laboratorio NO existen (404) y no aparecen en Swagger"
  ej "LAB_ENDPOINTS=false docker compose up -d --wait inventory-service 2>&1 | tail -n 1"
  ej 'pedir "$T_ADMIN" POST /api/repuestos/reiniciar'
  ej 'pedir "$T_ADMIN" POST /api/repuestos/$REP_FILTRO/descontar-sin-lock "{}" | tail -n 1'
  ej 'pedir "$T_ADMIN" GET /api/repuestos/$REP_FILTRO/lock | tail -n 1'
  ej "curl -s $GW/api-docs/inventory.json | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(Object.keys(JSON.parse(d).paths).join('\\n')))\""
  ej "docker compose logs --no-color --since 30s inventory-service | grep -o 'laboratorio=[a-zA-Z]*' | tail -n 1"
  nota "Se vuelve a activar para el resto de las pruebas."
  ej "LAB_ENDPOINTS=true docker compose up -d --wait inventory-service 2>&1 | tail -n 1"
fi

# ------------------------------------------------------------------ 12 reposición pendiente
if seccion "11-reposicion-con-inventory-caido"; then
  asegurar_usuarios
  reiniciar_stock
  nota "Resiliencia: si inventory no responde al cancelar, la orden se cancela igual y la reposición queda PENDIENTE."
  OP=$(pedir "$T_MEC1" POST /api/ordenes "{\"vehiculoId\":\"$VEH_COROLLA\",\"descripcion\":\"Cambio de pastillas\",\"repuestos\":[{\"repuestoId\":\"$REP_PASTILLAS\",\"cantidad\":2}]}" | campo 'j.id')
  ej stock
  ej "docker compose stop inventory-service 2>&1 | tail -n 1"
  ej "ver \"\$T_MEC1\" POST /api/ordenes/\$OP/cancelar '{\"motivo\":\"El cliente retiró el auto\"}' '({estado:j.estado, requiereCompensacion:j.requiereCompensacion, reposicion:j.reposicion, items:j.items.map(i=>i.codigo+\" \"+i.estado)})'"
  ej "docker compose start inventory-service 2>&1 | tail -n 1"
  esperar_sano inventory-service
  nota "El stock no se perdió: el libro sigue teniendo el descuento de la orden. Se reintenta → COMPLETA"
  ej "ver \"\$T_MEC1\" POST /api/ordenes/\$OP/reponer '' '({estado:j.estado, requiereCompensacion:j.requiereCompensacion, reposicion:j.reposicion, items:j.items.map(i=>i.codigo+\" \"+i.estado)})'"
  ej stock
  ej 'pedir "$T_MEC1" POST /api/ordenes/$OP/reponer | tail -n 2'
fi

# ------------------------------------------------------------------ 13 métricas
if seccion "12-metricas"; then
  asegurar_usuarios
  nota "Observabilidad: cada servicio expone GET /metrics (pedidos, errores, tiempos por ruta)."
  nota "El gateway publica las suyas y el agregado de todos en /metrics/servicios."
  for _ in 1 2 3; do pedir "$T_MEC1" GET /api/vehiculos >/dev/null; pedir "$T_MEC1" GET /api/repuestos >/dev/null; done
  ej "curl -s $GW/metrics/servicios | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('servicio'.padEnd(20),'pedidos','5xx','p95ms','promms');for(const r of j.resumen)console.log(r.servicio.padEnd(20),String(r.pedidos).padStart(7),String(r.errores5xx).padStart(4),String(r.p95Ms).padStart(6),String(r.promedioMs).padStart(6))})\""
  nota "Cuello de botella: workorders es el más lento porque cada orden espera, en serie, los descuentos de inventory"
  nota "(cada uno retenido DEMO_DELAY_MS dentro del lock). El detalle por ruta lo confirma:"
  ej "curl -s $GW/metrics/servicios | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const m=JSON.parse(d).servicios['workorders-service'];console.log(JSON.stringify({pedidos:m.pedidos,tiempoRespuestaMs:m.tiempoRespuestaMs,porRuta:Object.fromEntries(Object.entries(m.porRuta).slice(0,6))},null,2))})\""
  nota "Mismo dato en formato Prometheus (para un recolector externo; centralizarlo queda fuera de alcance):"
  ej "curl -s '$GW/metrics?formato=prometheus' | head -n 12"
fi

echo; echo "Evidencias en $EVID/"
