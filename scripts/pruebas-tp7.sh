#!/usr/bin/env bash
# Pruebas obligatorias del TP7 (sección 19, escenarios A–L) + extras de
# seguridad. Requiere Docker, curl, node y bash. Cada sección deja su salida en
# docs/tp7/evidencias/.
#
#   bash scripts/pruebas-tp7.sh            → todas las secciones
#   bash scripts/pruebas-tp7.sh G-         → solo las que empiezan así
#
# Adaptado a las correcciones: alta administrada (A y B), vehículos con dueño.
# Levantar con LAB_ENDPOINTS=true (I usa reiniciar). Las evidencias del TP7 ya
# entregadas (tag tp7-entrega) no se vuelven a commitear.
#
# Convención de la evidencia:
#   pedir "$TOKEN" MÉTODO RUTA [BODY]  =  curl -X MÉTODO $GW$RUTA -H "Authorization: Bearer $TOKEN" [-d BODY]
#   (pedir "" ... = sin header Authorization)
# Los tokens NUNCA se imprimen completos: solo sus primeros caracteres y el
# payload decodificado. La contraseña del admin sale de .env y no se muestra.
set -uo pipefail
cd "$(dirname "$0")/.."

GW="${GW:-http://localhost:3000}"
EVID="docs/tp7/evidencias"
FILTRO="${1:-}"
JSON='content-type: application/json'
mkdir -p "$EVID"

VEH_COROLLA=68c000000000000000000001
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

# Oculta tokens en cualquier salida JSON (accessToken → primeros 16 caracteres).
ocultar() { sed -E 's/("accessToken":")([^"]{16})[^"]*"/\1\2…(oculto)"/g'; }

pedir() { # pedir TOKEN MÉTODO RUTA [BODY] → cuerpo + "HTTP nnn"
  local t="$1" m="$2" r="$3" b="${4:-}" auth=()
  [ -n "$t" ] && auth=(-H "Authorization: Bearer $t")
  if [ -n "$b" ]; then curl -s -X "$m" "$GW$r" "${auth[@]}" -H "$JSON" -d "$b" -w '\nHTTP %{http_code}'
  else curl -s -X "$m" "$GW$r" "${auth[@]}" -w '\nHTTP %{http_code}'; fi | ocultar
  echo
}
token_de() { # token_de EMAIL PASSWORD → access token (sin imprimir nada más)
  curl -s -X POST "$GW/api/auth/login" -H "$JSON" -d "{\"email\":\"$1\",\"password\":\"$2\"}" |
    node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).accessToken||'')}catch{}})"
}
decodificar() { # decodificar TOKEN → header y payload legibles (sin firma)
  node -e '
    const [h, p] = process.argv[1].split(".");
    const dec = (s) => JSON.parse(Buffer.from(s, "base64url").toString());
    const pl = dec(p);
    console.log("header :", JSON.stringify(dec(h)));
    console.log("payload:", JSON.stringify(pl));
    console.log("iat    :", new Date(pl.iat * 1000).toISOString());
    console.log("exp    :", new Date(pl.exp * 1000).toISOString(), `(vigencia ${pl.exp - pl.iat} s)`);
  ' "$1"
}
corto() { echo "${1:0:16}…(${#1} caracteres)"; }
esperar_sano() {
  for s in "$@"; do
    for _ in $(seq 1 60); do
      id=$(docker compose ps -q "$s")
      [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)" = "healthy" ] && break
      sleep 2
    done
  done
}
resumen_spec() { # resumen_spec < spec.json → esquema de seguridad y acceso por operación
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const j = JSON.parse(d);
    console.log(j.info.title, '· securitySchemes:', Object.keys((j.components || {}).securitySchemes || {}).join(','));
    for (const [p, o] of Object.entries(j.paths)) for (const [m, op] of Object.entries(o)) {
      if (!op.responses) continue;
      const seg = Object.keys(op.responses).filter((c) => c === '401' || c === '403').join(' ');
      console.log(' ', (op.security ? '[bearer]' : '[público]').padEnd(9), m.toUpperCase().padEnd(6), p.padEnd(40), seg.padEnd(7), op.summary);
    }
  })"
}
id_de() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=d.split('\nHTTP')[0];try{process.stdout.write(JSON.parse(t).id||'')}catch{}})"; }

asegurar_usuarios() { # crea los mecánicos de prueba si no existen (alta administrada, idempotente)
  local ta; ta=$(token_de "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
  for u in "$MEC1:Mecanico Uno" "$MEC2:Mecanico Dos"; do
    curl -s -o /dev/null -X POST "$GW/api/auth/usuarios" -H "$JSON" -H "Authorization: Bearer $ta" \
      -d "{\"email\":\"${u%%:*}\",\"nombre\":\"${u#*:}\",\"password\":\"$PASS_MEC\"}"
  done
}

# ------------------------------------------------------------------ 00 arranque
if seccion "00-arranque"; then
  nota "Configuración: .env (no versionado) creado con scripts/generar-env.sh. Se muestran solo los nombres de las variables."
  ej "git check-ignore -v .env"
  ej "grep -E '^[A-Z_]+=' .env | cut -d= -f1 | tr '\n' ' '"
  ej "docker compose up --build -d --wait 2>&1 | tail -n 11"
  ej "curl -s $GW/health/servicios"
fi

# ------------------------------------------------------------------ A registro
if seccion "A-registro"; then
  nota "Corrección (requisito 1): el alta es ADMINISTRADA. No hay registro público; los mecánicos los crea un ADMIN."
  nota "Estado inicial: solo el admin (se borran los MECANICO de corridas anteriores)."
  ej "docker compose exec -T auth-db mongosh auth --quiet --eval 'db.usuarios.deleteMany({rol: \"MECANICO\"}).deletedCount'"
  T_ADMIN=$(token_de "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
  ej "pedir \"\$T_ADMIN\" POST /api/auth/usuarios '{\"email\":\"$MEC1\",\"nombre\":\"Mecanico Uno\",\"password\":\"$PASS_MEC\"}'"
  ej "pedir \"\$T_ADMIN\" POST /api/auth/usuarios '{\"email\":\"$MEC2\",\"nombre\":\"Mecanico Dos\",\"password\":\"$PASS_MEC\"}'"
  nota "Datos inválidos → 400 controlado"
  ej "pedir \"\$T_ADMIN\" POST /api/auth/usuarios '{\"email\":\"no-es-email\",\"nombre\":\"X\",\"password\":\"corta\"}'"
  nota "El registro público ya no existe → 404"
  ej "pedir '' POST /api/auth/register '{\"email\":\"otro@torque.local\",\"nombre\":\"Otro\",\"password\":\"$PASS_MEC\"}'"
fi

# ------------------------------------------------------------------ B duplicado
if seccion "B-duplicado"; then
  asegurar_usuarios
  T_ADMIN=$(token_de "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
  T_MEC1=$(token_de "$MEC1" "$PASS_MEC")
  nota "Mismo email (también con otra capitalización) → 409"
  ej "pedir \"\$T_ADMIN\" POST /api/auth/usuarios '{\"email\":\"$MEC1\",\"nombre\":\"Otro\",\"password\":\"$PASS_MEC\"}'"
  ej "pedir \"\$T_ADMIN\" POST /api/auth/usuarios '{\"email\":\"MECANICO1@torque.local\",\"nombre\":\"Otro\",\"password\":\"$PASS_MEC\"}'"
  nota "Un MECANICO no puede crear usuarios (ni auto-asignarse ADMIN) → 403"
  ej "pedir \"\$T_MEC1\" POST /api/auth/usuarios '{\"email\":\"intruso@torque.local\",\"nombre\":\"Intruso\",\"password\":\"$PASS_MEC\",\"rol\":\"ADMIN\"}'"
fi

# ------------------------------------------------------------------ C login OK
if seccion "C-login-valido"; then
  asegurar_usuarios
  ej "pedir '' POST /api/auth/login '{\"email\":\"$MEC1\",\"password\":\"$PASS_MEC\"}'"
  T_MEC1=$(token_de "$MEC1" "$PASS_MEC")
  nota "Contenido del JWT (header.payload decodificados; la firma no se muestra):"
  ej 'decodificar "$T_MEC1"'
  nota "Claims: sub (id del usuario), rol, iss, aud, iat y exp. Sin email, nombre, contraseña ni hash."
  nota "Login del admin inicial (credenciales desde .env):"
  T_ADMIN=$(token_de "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
  ej 'decodificar "$T_ADMIN"'
fi

# ------------------------------------------------------------------ D login inválido
if seccion "D-login-invalido"; then
  asegurar_usuarios
  nota "Password incorrecta y usuario inexistente → el MISMO 401 genérico (no revela cuál falló)"
  ej "pedir '' POST /api/auth/login '{\"email\":\"$MEC1\",\"password\":\"incorrecta-123\"}'"
  ej "pedir '' POST /api/auth/login '{\"email\":\"nadie@torque.local\",\"password\":\"incorrecta-123\"}'"
  nota "Entrada inválida → 400"
  ej "pedir '' POST /api/auth/login '{\"email\":\"$MEC1\"}'"
  nota "Log interno: motivo técnico, email enmascarado, nunca la contraseña"
  ej "docker compose logs --no-color --since 30s auth-service | grep -E 'Login' | cut -d'|' -f2- | tail -n 4"
fi

# ------------------------------------------------------------------ E sin token
if seccion "E-sin-token"; then
  nota "Endpoint protegido sin Authorization → 401 + WWW-Authenticate"
  ej "curl -s -i $GW/api/vehiculos | grep -iE '^HTTP|^www-authenticate|^\\{'"
  nota "Header mal formado (sin 'Bearer') y token que no es un JWT → 401"
  ej "curl -s $GW/api/ordenes -H 'Authorization: abc123' -w '\nHTTP %{http_code}\n'"
  ej "pedir 'esto-no-es-un-jwt' GET /api/ordenes"
  nota "Corrección (requisito 5): el catálogo de repuestos ya no es público → también 401 sin token"
  ej "pedir '' GET /api/repuestos/$REP_BUJIAS"
fi

# ------------------------------------------------------------------ F token modificado
if seccion "F-token-modificado"; then
  asegurar_usuarios
  T_MEC1=$(token_de "$MEC1" "$PASS_MEC")
  nota "Se edita el payload del token de un MECANICO (rol → ADMIN) conservando la firma original."
  T_FALSO=$(node -e '
    const [h, p, s] = process.argv[1].split(".");
    const pl = JSON.parse(Buffer.from(p, "base64url"));
    pl.rol = "ADMIN";
    process.stdout.write([h, Buffer.from(JSON.stringify(pl)).toString("base64url"), s].join("."));
  ' "$T_MEC1")
  ej 'decodificar "$T_FALSO" | grep payload'
  ej 'pedir "$T_FALSO" DELETE /api/vehiculos/000000000000000000000000'
  nota "Token sin firma (alg=none) → 401"
  T_NONE=$(node -e '
    const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const ahora = Math.floor(Date.now() / 1000);
    process.stdout.write(b({ alg: "none", typ: "JWT" }) + "." + b({ sub: "x", rol: "ADMIN", iss: "torque-auth", aud: "torque", iat: ahora, exp: ahora + 600 }) + ".");
  ')
  ej 'pedir "$T_NONE" GET /api/vehiculos'
  nota "Token bien formado pero firmado con OTRA clave → 401"
  T_OTRA=$(docker compose exec -T auth-service node -e '
    const jwt = require("jsonwebtoken");
    process.stdout.write(jwt.sign({ rol: "ADMIN" }, "clave-distinta-de-la-configurada-0123456789", { subject: "x", issuer: "torque-auth", audience: "torque", expiresIn: "10m" }));
  ')
  ej 'pedir "$T_OTRA" GET /api/vehiculos'
  ej "docker compose logs --no-color --since 30s vehicles-service | grep -E '401' | cut -d'|' -f2- | tail -n 3"
fi

# ------------------------------------------------------------------ G token vencido
if seccion "G-token-vencido"; then
  asegurar_usuarios
  nota "Se reinicia SOLO auth-service con JWT_EXPIRES_IN=5s (configuración externa, sin tocar código)."
  ej "JWT_EXPIRES_IN=5s docker compose up -d --wait auth-service 2>&1 | tail -n 1"
  T_CORTO=$(token_de "$MEC1" "$PASS_MEC")
  ej 'decodificar "$T_CORTO" | tail -n 2'
  ej 'pedir "$T_CORTO" GET /api/vehiculos/$VEH_COROLLA'
  nota "Se espera 7 segundos…"
  sleep 7
  ej 'pedir "$T_CORTO" GET /api/vehiculos/$VEH_COROLLA'
  nota "Se restaura la vigencia normal."
  ej "docker compose up -d --wait auth-service 2>&1 | tail -n 1"
fi

# ------------------------------------------------------------------ H rol insuficiente
if seccion "H-rol-insuficiente"; then
  asegurar_usuarios
  T_MEC1=$(token_de "$MEC1" "$PASS_MEC")
  T_MEC2=$(token_de "$MEC2" "$PASS_MEC")
  nota "Token válido de MECANICO en operaciones exclusivas de ADMIN → 403 (no 401)"
  ej 'pedir "$T_MEC1" DELETE /api/vehiculos/$VEH_COROLLA'
  ej 'pedir "$T_MEC1" POST /api/repuestos/reiniciar'
  ej 'pedir "$T_MEC1" GET /api/auth/usuarios'
  nota "Propiedad del recurso: MECANICO 2 intenta ver una orden creada por MECANICO 1 → 403"
  ORDEN=$(pedir "$T_MEC1" POST /api/ordenes "{\"vehiculoId\":\"$VEH_COROLLA\",\"descripcion\":\"Orden de mecanico 1\"}" | id_de)
  ej 'pedir "$T_MEC2" GET /api/ordenes/$ORDEN'
  nota "…y su listado no incluye órdenes ajenas:"
  ej "pedir \"\$T_MEC2\" GET /api/ordenes | grep -c '\"id\"' || true"
fi

# ------------------------------------------------------------------ I rol autorizado
if seccion "I-rol-autorizado"; then
  asegurar_usuarios
  T_ADMIN=$(token_de "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
  T_MEC1=$(token_de "$MEC1" "$PASS_MEC")
  docker compose exec -T vehicles-db mongosh vehicles --quiet --eval 'db.vehiculos.deleteMany({patente: "AE001ZZ"})' >/dev/null
  nota "MECANICO: alta de vehículo (MECANICO, ADMIN) → 201"
  ej 'pedir "$T_MEC1" POST /api/vehiculos "{\"marca\":\"Fiat\",\"modelo\":\"Cronos\",\"anio\":2022,\"patente\":\"AE001ZZ\",\"kilometraje\":15000,\"duenio\":{\"nombre\":\"Pedro Díaz\",\"telefono\":\"261 555-0199\"}}"'
  VEH_NUEVO=$(pedir "$T_ADMIN" GET /api/vehiculos | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const v=JSON.parse(d.split('\nHTTP')[0]).find(x=>x.patente==='AE001ZZ');process.stdout.write(v?v.id:'')})")
  nota "ADMIN: baja (lógica) del vehículo (solo ADMIN) → 200"
  ej 'pedir "$T_ADMIN" DELETE /api/vehiculos/$VEH_NUEVO'
  nota "ADMIN: operación de laboratorio sobre stock → 200"
  ej 'pedir "$T_ADMIN" POST /api/repuestos/reiniciar'
  nota "ADMIN: administración de usuarios → 200 (sin hashes en la respuesta)"
  ej 'pedir "$T_ADMIN" GET /api/auth/usuarios'
  nota "ADMIN ve las órdenes de todos; MECANICO 1 ve la suya"
  ORDEN=$(pedir "$T_MEC1" POST /api/ordenes "{\"vehiculoId\":\"$VEH_COROLLA\",\"descripcion\":\"Orden propia\"}" | id_de)
  ej 'pedir "$T_MEC1" GET /api/ordenes/$ORDEN | grep -E "creadaPor|HTTP" | head -c 200; echo'
  ej 'pedir "$T_ADMIN" GET /api/ordenes/$ORDEN | grep -oE "\"creadaPor\":\"[a-f0-9]+\"|HTTP [0-9]+"'
fi

# ------------------------------------------------------------------ J propagación
if seccion "J-propagacion"; then
  asegurar_usuarios
  T_MEC1=$(token_de "$MEC1" "$PASS_MEC")
  nota "Caso de uso que atraviesa 3 servicios: gateway → workorders → vehicles (GET) + inventory (POST descontar)."
  nota "workorders reenvía el MISMO token del usuario; vehicles e inventory lo validan cada uno por su cuenta."
  ej 'pedir "$T_MEC1" POST /api/ordenes "{\"vehiculoId\":\"$VEH_COROLLA\",\"descripcion\":\"Cambio de bujías\",\"repuestos\":[{\"repuestoId\":\"$REP_BUJIAS\",\"cantidad\":1}]}"'
  RID=$(docker compose logs --no-color --since 20s api-gateway | grep 'POST /api/ordenes' | tail -n 1 | grep -oE 'rid=[a-f0-9-]+' | cut -d= -f2)
  nota "Mismo request id en los 4 servicios; inventory aceptó el descuento con la identidad propagada:"
  ej "docker compose logs --no-color --since 30s | grep '$RID' | cut -d'|' -f2- | cut -c27-"
  nota "La orden queda a nombre del sub del token (creadaPor):"
  ej 'decodificar "$T_MEC1" | grep payload'
  nota "Sin identidad, el descuento se rechaza también DENTRO de la red backend (no se confía en el gateway):"
  ej "docker compose exec -T workorders-service node -e \"fetch('http://inventory-service:3000/api/repuestos/$REP_BUJIAS/descontar',{method:'POST',headers:{'content-type':'application/json'},body:'{\\\"cantidad\\\":1}'}).then(async r=>console.log(r.status, await r.text()))\""
fi

# ------------------------------------------------------------------ K reinicio
if seccion "K-reinicio"; then
  asegurar_usuarios
  nota "docker compose down (SIN -v) + up: contenedores nuevos, volumen auth-data intacto"
  ej "docker compose ps -q auth-service | cut -c1-12"
  ej "docker compose down 2>&1 | tail -n 2"
  ej "docker compose up -d --wait 2>&1 | tail -n 2"
  ej "docker compose ps -q auth-service | cut -c1-12"
  nota "El usuario registrado antes sigue existiendo y vuelve a autenticarse:"
  ej "pedir '' POST /api/auth/login '{\"email\":\"$MEC1\",\"password\":\"$PASS_MEC\"}'"
  T_MEC1=$(token_de "$MEC1" "$PASS_MEC")
  ej 'pedir "$T_MEC1" GET /api/auth/me'
  ej 'pedir "$T_MEC1" GET /api/vehiculos/$VEH_COROLLA'
fi

# ------------------------------------------------------------------ L hash
if seccion "L-hash-persistido"; then
  asegurar_usuarios
  nota "Documentos en auth-db (base de auth-service, sin puertos publicados):"
  ej "docker compose exec -T auth-db mongosh auth --quiet --eval 'db.usuarios.find({}, {_id:0, email:1, rol:1, activo:1, passwordHash:1}).toArray()'"
  nota "passwordHash = bcrypt (\$2b\$, costo 12, salt incluido). La contraseña en texto plano no aparece en la base:"
  ej "docker compose exec -T auth-db mongosh auth --quiet --eval 'db.usuarios.countDocuments({passwordHash: \"$PASS_MEC\"})'"
  ej "docker compose exec -T auth-db mongosh auth --quiet --eval 'JSON.stringify(db.usuarios.find().toArray()).includes(\"$PASS_MEC\")'"
  nota "Las demás bases no tienen usuarios (nadie más guarda credenciales):"
  for s in vehicles inventory workorders; do
    ej "docker compose exec -T $s-db mongosh $s --quiet --eval 'db.getCollectionNames()'"
  done
fi

# ------------------------------------------------------------------ M auth caído
if seccion "M-auth-no-disponible"; then
  asegurar_usuarios
  T_MEC1=$(token_de "$MEC1" "$PASS_MEC")
  nota "Se detiene auth-service DESPUÉS de emitir el token."
  ej "docker compose stop auth-service 2>&1 | tail -n 1"
  nota "El token ya emitido sigue siendo válido: los servicios verifican la firma localmente, sin consultar a auth-service."
  ej 'pedir "$T_MEC1" GET /api/vehiculos/$VEH_COROLLA | tail -n 1'
  ej 'pedir "$T_MEC1" POST /api/ordenes "{\"vehiculoId\":\"$VEH_COROLLA\",\"descripcion\":\"Con auth caído\"}" | tail -n 1'
  nota "Lo que no se puede es obtener tokens nuevos: login → 503 controlado del gateway"
  ej "pedir '' POST /api/auth/login '{\"email\":\"$MEC1\",\"password\":\"$PASS_MEC\"}'"
  ej "docker compose start auth-service 2>&1 | tail -n 1"
  esperar_sano auth-service
  ej "pedir '' POST /api/auth/login '{\"email\":\"$MEC1\",\"password\":\"$PASS_MEC\"}' | tail -n 1"
fi

# ------------------------------------------------------------------ N swagger
if seccion "N-swagger"; then
  nota "Swagger agregado en $GW/api-docs (selector: vehicles, inventory, workorders, auth, gateway)."
  nota "Esquema Bearer y operaciones protegidas con su rol y respuestas 401/403:"
  for s in auth vehicles inventory workorders; do
    ej "curl -s $GW/api-docs/$s.json | resumen_spec"
  done
fi

# ------------------------------------------------------------------ O secretos
if seccion "O-secretos"; then
  nota "Ningún .env real ni clave versionada (solo los .env.example):"
  ej "git ls-files | grep -E '(^|/)\\.env|\\.key\$|\\.pem\$|\\.crt\$'"
  nota "El JWT_SECRET en uso no aparece en ningún commit del historial:"
  ej "git log --all -p | grep -c \"\$JWT_SECRET\" || true"
  nota "Los logs no contienen tokens completos ni contraseñas:"
  T_MEC1=$(token_de "$MEC1" "$PASS_MEC")
  pedir "$T_MEC1" GET /api/vehiculos >/dev/null
  ej "docker compose logs --no-color | grep -cE 'eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.' || true"
  ej "docker compose logs --no-color | grep -c '$PASS_MEC' || true"
  ej 'docker compose logs --no-color | grep -c "$ADMIN_PASSWORD" || true'
fi

echo; echo "Evidencias en $EVID/"
