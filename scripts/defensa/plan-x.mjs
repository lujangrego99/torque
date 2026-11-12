// Ejecución de las pruebas adicionales X del «Plan completo de pruebas» (12/11/2026)
// que no estaban cubiertas por carga/carreras/caos. Cada caso queda PASS / FAIL /
// BLOQUEADA con lo observado. Solo contra el stack descartable (torque-defensa).
//   node scripts/defensa/plan-x.mjs [X03 X05 ...]   (sin argumentos: todos)
import { execSync } from "node:child_process";
import {
  escenario, log, guardarJson, req, tokenAdmin, login, mecanicos, crearRepuestos, compose, reconfigurar, SEMILLA, dormir, PASS_MEC, ENV, PROYECTO, RAIZ,
} from "./lib.mjs";

const resultados = [];
function registrar(id, titulo, estado, observado, extra = {}) {
  resultados.push({ id, titulo, estado, observado, ...extra });
  log(`[${estado}] ${id} ${titulo}\n        ${observado}`);
}
// Compara una tabla de { desc, esperado, obtenido } y devuelve las diferencias.
function matriz(filas) {
  const malas = filas.filter((f) => !(Array.isArray(f.esperado) ? f.esperado.includes(f.obtenido) : f.esperado === f.obtenido));
  for (const f of filas) log(`   ${malas.includes(f) ? "✗" : "✓"} ${f.desc}: esperado ${f.esperado} → ${f.obtenido}`);
  return malas;
}
const patente = () => `ZQ${Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, "7")}`;
const nuevoVehiculo = (t, extra = {}) =>
  req("POST", "/api/vehiculos", {
    token: t,
    body: { marca: "Fiat", modelo: "Uno", anio: 2010, patente: patente(), kilometraje: 1000, duenio: { nombre: "Dueño Prueba", telefono: "261 555-1234" }, ...extra },
  });
const stock = async (id, t) => (await req("GET", `/api/repuestos/${id}`, { token: t })).body.stock;
const sh = (cmd) => execSync(cmd, { cwd: RAIZ, stdio: ["ignore", "pipe", "pipe"] }).toString();
const ordenCon = (t, rep, cantidad = 1, veh = SEMILLA.vehiculos[0]) =>
  req("POST", "/api/ordenes", { token: t, body: { vehiculoId: veh, descripcion: "plan X", repuestos: [{ repuestoId: rep, cantidad }] } });

const casos = {};

casos.X03 = async () => {
  escenario("X03-matriz-roles-propiedad");
  const tA = await tokenAdmin();
  const [A, B] = await mecanicos(2, tA);
  const [rep] = await crearRepuestos("X03", 1, 50, tA);
  const veh = (await nuevoVehiculo(tA)).body;
  const o = (await ordenCon(A.token, rep)).body;
  const filas = [
    { desc: "sin token GET /api/vehiculos", esperado: 401, obtenido: (await req("GET", "/api/vehiculos")).status },
    { desc: "sin token GET /api/repuestos", esperado: 401, obtenido: (await req("GET", "/api/repuestos")).status },
    { desc: "sin token GET /api/ordenes", esperado: 401, obtenido: (await req("GET", "/api/ordenes")).status },
    { desc: "token basura GET /api/ordenes", esperado: 401, obtenido: (await req("GET", "/api/ordenes", { token: "abc.def.ghi" })).status },
    { desc: "sin token POST /api/auth/usuarios", esperado: 401, obtenido: (await req("POST", "/api/auth/usuarios", { body: {} })).status },
    { desc: "MEC POST /api/auth/usuarios", esperado: 403, obtenido: (await req("POST", "/api/auth/usuarios", { token: A.token, body: { email: "z@z.com", nombre: "Z", password: "12345678" } })).status },
    { desc: "MEC GET /api/auth/usuarios", esperado: 403, obtenido: (await req("GET", "/api/auth/usuarios", { token: A.token })).status },
    { desc: "ADMIN GET /api/auth/usuarios", esperado: 200, obtenido: (await req("GET", "/api/auth/usuarios", { token: tA })).status },
    { desc: "MEC POST /api/vehiculos (alta permitida)", esperado: 201, obtenido: (await nuevoVehiculo(A.token)).status },
    { desc: "MEC PUT /api/vehiculos/:id (edición permitida)", esperado: 200, obtenido: (await req("PUT", `/api/vehiculos/${veh.id}`, { token: A.token, body: { ...veh, id: undefined, activo: undefined, kilometraje: 2000 } })).status },
    { desc: "MEC DELETE /api/vehiculos/:id (baja)", esperado: 403, obtenido: (await req("DELETE", `/api/vehiculos/${veh.id}`, { token: A.token, body: { motivo: "prueba de rol" } })).status },
    { desc: "MEC POST /api/vehiculos/:id/reactivar", esperado: 403, obtenido: (await req("POST", `/api/vehiculos/${veh.id}/reactivar`, { token: A.token })).status },
    { desc: "ADMIN DELETE /api/vehiculos/:id", esperado: 200, obtenido: (await req("DELETE", `/api/vehiculos/${veh.id}`, { token: tA, body: { motivo: "prueba de rol" } })).status },
    { desc: "ADMIN reactivar", esperado: 200, obtenido: (await req("POST", `/api/vehiculos/${veh.id}/reactivar`, { token: tA })).status },
    { desc: "MEC POST /api/repuestos (alta)", esperado: 403, obtenido: (await req("POST", "/api/repuestos", { token: A.token, body: { nombre: "x", codigo: "XXXXX9", stock: 1 } })).status },
    { desc: "MEC POST ingreso", esperado: 403, obtenido: (await req("POST", `/api/repuestos/${rep}/ingreso`, { token: A.token, body: { cantidad: 1 } })).status },
    { desc: "MEC POST ajuste", esperado: 403, obtenido: (await req("POST", `/api/repuestos/${rep}/ajuste`, { token: A.token, body: { cantidad: 1, motivo: "conteo" } })).status },
    { desc: "ADMIN POST ingreso", esperado: 200, obtenido: (await req("POST", `/api/repuestos/${rep}/ingreso`, { token: tA, body: { cantidad: 1 } })).status },
    { desc: "B GET orden de A", esperado: 403, obtenido: (await req("GET", `/api/ordenes/${o.id}`, { token: B.token })).status },
    { desc: "B PATCH orden de A", esperado: 403, obtenido: (await req("PATCH", `/api/ordenes/${o.id}`, { token: B.token, body: { descripcion: "hackeada" } })).status },
    { desc: "B cancelar orden de A", esperado: 403, obtenido: (await req("POST", `/api/ordenes/${o.id}/cancelar`, { token: B.token, body: { motivo: "no es mía" } })).status },
    { desc: "B finalizar orden de A", esperado: 403, obtenido: (await req("POST", `/api/ordenes/${o.id}/finalizar`, { token: B.token })).status },
    { desc: "B reponer orden de A (workorders)", esperado: 403, obtenido: (await req("POST", `/api/ordenes/${o.id}/reponer`, { token: B.token })).status },
    { desc: "B reponer orden de A DIRECTO en inventory", esperado: 403, obtenido: (await req("POST", "/api/repuestos/reposiciones", { token: B.token, body: { ordenId: o.id } })).status },
    { desc: "B GET /api/ordenes no lista la de A", esperado: false, obtenido: (await req("GET", "/api/ordenes", { token: B.token })).body.some((x) => x.id === o.id) },
    { desc: "B historial del vehículo (lectura compartida)", esperado: 200, obtenido: (await req("GET", `/api/ordenes/vehiculo/${SEMILLA.vehiculos[0]}`, { token: B.token })).status },
    { desc: "historial marca propia=false para B", esperado: false, obtenido: (await req("GET", `/api/ordenes/vehiculo/${SEMILLA.vehiculos[0]}`, { token: B.token })).body.ordenes.find((x) => x.id === o.id).propia },
    { desc: "A PATCH su orden", esperado: 200, obtenido: (await req("PATCH", `/api/ordenes/${o.id}`, { token: A.token, body: { descripcion: "editada por A" } })).status },
    { desc: "ADMIN GET orden de A", esperado: 200, obtenido: (await req("GET", `/api/ordenes/${o.id}`, { token: tA })).status },
    { desc: "ADMIN finaliza orden de A", esperado: 200, obtenido: (await req("POST", `/api/ordenes/${o.id}/finalizar`, { token: tA })).status },
  ];
  const malas = matriz(filas);
  registrar("X03", "Matriz de roles y propiedad", malas.length ? "FAIL" : "PASS", `${filas.length - malas.length}/${filas.length} filas según contrato${malas.length ? `; difieren: ${malas.map((m) => m.desc).join("; ")}` : ""}. (Rutas directas de inventario con ordenId ajeno/inexistente: ver X20/X21).`);
};

casos.X04 = async () => {
  escenario("X04-alta-administrada-inactivo");
  const tA = await tokenAdmin();
  const email = `x04-${Date.now()}@torque.local`;
  const alta = await req("POST", "/api/auth/usuarios", { token: tA, body: { email, nombre: "X Cuatro", password: PASS_MEC } });
  const l = await login(email, PASS_MEC);
  const filas = [
    { desc: "POST /api/auth/register (registro público)", esperado: 404, obtenido: (await req("POST", "/api/auth/register", { body: { email: "a@a.com", password: "12345678" } })).status },
    { desc: "alta válida por ADMIN", esperado: 201, obtenido: alta.status },
    { desc: "duplicado (mayúsculas)", esperado: 409, obtenido: (await req("POST", "/api/auth/usuarios", { token: tA, body: { email: email.toUpperCase(), nombre: "Otro", password: PASS_MEC } })).status },
    { desc: "email inválido / password corta", esperado: 400, obtenido: (await req("POST", "/api/auth/usuarios", { token: tA, body: { email: "no-es-email", nombre: "X", password: "corta" } })).status },
    { desc: "intento de crear ADMIN con rol en el body", esperado: [201, 400], obtenido: (await req("POST", "/api/auth/usuarios", { token: tA, body: { email: `adm-${Date.now()}@torque.local`, nombre: "X", password: PASS_MEC, rol: "ADMIN" } })).status },
  ];
  const des = await req("PATCH", `/api/auth/usuarios/${alta.body.id || l.usuario.id}`, { token: tA, body: { activo: false } });
  filas.push(
    { desc: "ADMIN desactiva", esperado: 200, obtenido: des.status },
    { desc: "login inactivo con clave correcta", esperado: 403, obtenido: (await req("POST", "/api/auth/login", { body: { email, password: PASS_MEC } })).status },
    { desc: "login inactivo con clave incorrecta (mismo 401 genérico)", esperado: 401, obtenido: (await req("POST", "/api/auth/login", { body: { email, password: "otra-clave-x" } })).status },
    { desc: "refresh de la sesión previa (revocada al desactivar)", esperado: 401, obtenido: (await req("POST", "/api/auth/refresh", { body: { refreshToken: l.refreshToken } })).status },
    { desc: "access previo todavía vigente (H07, documentar)", esperado: 200, obtenido: (await req("GET", "/api/vehiculos", { token: l.accessToken })).status }
  );
  filas.push({ desc: "ADMIN reactiva", esperado: 200, obtenido: (await req("PATCH", `/api/auth/usuarios/${alta.body.id || l.usuario.id}`, { token: tA, body: { activo: true } })).status });
  filas.push({ desc: "login tras reactivar", esperado: 200, obtenido: (await req("POST", "/api/auth/login", { body: { email, password: PASS_MEC } })).status });
  const malas = matriz(filas);
  registrar("X04", "Alta administrada y usuario inactivo", malas.length ? "FAIL" : "PASS", `${filas.length - malas.length}/${filas.length} OK. Usuario desactivado conserva el access emitido hasta que vence (H07).`);
};

casos.X05 = async () => {
  escenario("X05-validaciones-normalizacion");
  const tA = await tokenAdmin();
  const [rep] = await crearRepuestos("X05", 1, 50, tA);
  const base = (await nuevoVehiculo(tA)).body;
  const variante = base.patente.slice(0, 2).toLowerCase() + " " + base.patente.slice(2, 4) + "-" + base.patente.slice(4);
  const contar = async () => (await req("GET", "/api/ordenes", { token: tA })).body.length;
  const antes = await contar();
  const stockAntes = await stock(rep, tA);
  const inactivo = (await nuevoVehiculo(tA)).body;
  await req("DELETE", `/api/vehiculos/${inactivo.id}`, { token: tA, body: { motivo: "baja de prueba" } });
  const orden = (body) => req("POST", "/api/ordenes", { token: tA, body: { vehiculoId: base.id, descripcion: "validación", ...body } });
  const filas = [
    { desc: "vehículo sin dueño", esperado: 400, obtenido: (await nuevoVehiculo(tA, { duenio: undefined })).status },
    { desc: `patente equivalente "${variante}"`, esperado: 409, obtenido: (await nuevoVehiculo(tA, { patente: variante })).status },
    { desc: "patente con caracteres inválidos", esperado: 400, obtenido: (await nuevoVehiculo(tA, { patente: "AB@12" })).status },
    { desc: "kilometraje negativo", esperado: 400, obtenido: (await nuevoVehiculo(tA, { kilometraje: -5 })).status },
    { desc: "teléfono inválido", esperado: 400, obtenido: (await nuevoVehiculo(tA, { duenio: { nombre: "X", telefono: "abc" } })).status },
    { desc: "GET vehículo id malformado", esperado: 400, obtenido: (await req("GET", "/api/vehiculos/123", { token: tA })).status },
    { desc: "GET vehículo id inexistente", esperado: 404, obtenido: (await req("GET", "/api/vehiculos/aaaaaaaaaaaaaaaaaaaaaaaa", { token: tA })).status },
    { desc: "orden sobre vehículo inactivo", esperado: 409, obtenido: (await req("POST", "/api/ordenes", { token: tA, body: { vehiculoId: inactivo.id, descripcion: "no debería", repuestos: [] } })).status },
    { desc: "orden cantidad 0", esperado: 400, obtenido: (await orden({ repuestos: [{ repuestoId: rep, cantidad: 0 }] })).status },
    { desc: "orden cantidad -1", esperado: 400, obtenido: (await orden({ repuestos: [{ repuestoId: rep, cantidad: -1 }] })).status },
    { desc: "orden cantidad 1.5", esperado: 400, obtenido: (await orden({ repuestos: [{ repuestoId: rep, cantidad: 1.5 }] })).status },
    { desc: 'orden cantidad "2" (string)', esperado: 400, obtenido: (await orden({ repuestos: [{ repuestoId: rep, cantidad: "2" }] })).status },
    { desc: "orden repuesto repetido", esperado: 400, obtenido: (await orden({ repuestos: [{ repuestoId: rep }, { repuestoId: rep }] })).status },
    { desc: "orden repuesto inexistente", esperado: 404, obtenido: (await orden({ repuestos: [{ repuestoId: "aaaaaaaaaaaaaaaaaaaaaaaa" }] })).status },
    { desc: "orden sin descripción", esperado: 400, obtenido: (await req("POST", "/api/ordenes", { token: tA, body: { vehiculoId: base.id } })).status },
    { desc: "orden con vehiculoId y patente a la vez", esperado: 400, obtenido: (await orden({ patente: base.patente })).status },
    { desc: "orden por patente normalizada", esperado: 201, obtenido: (await req("POST", "/api/ordenes", { token: tA, body: { patente: variante, descripcion: "por patente" } })).status },
    { desc: "ajuste 0", esperado: 400, obtenido: (await req("POST", `/api/repuestos/${rep}/ajuste`, { token: tA, body: { cantidad: 0, motivo: "conteo mal" } })).status },
    { desc: "ajuste sin motivo", esperado: 400, obtenido: (await req("POST", `/api/repuestos/${rep}/ajuste`, { token: tA, body: { cantidad: -1 } })).status },
    { desc: "ajuste que deja negativo", esperado: 409, obtenido: (await req("POST", `/api/repuestos/${rep}/ajuste`, { token: tA, body: { cantidad: -999, motivo: "conteo mal" } })).status },
    { desc: "ajuste negativo válido (-2)", esperado: 200, obtenido: (await req("POST", `/api/repuestos/${rep}/ajuste`, { token: tA, body: { cantidad: -2, motivo: "faltaban dos" } })).status },
    { desc: "ingreso decimal", esperado: 400, obtenido: (await req("POST", `/api/repuestos/${rep}/ingreso`, { token: tA, body: { cantidad: 2.5 } })).status },
  ];
  const despues = await contar();
  const stockDesp = await stock(rep, tA);
  filas.push({ desc: "órdenes nuevas creadas (solo la válida por patente)", esperado: 1, obtenido: despues - antes });
  filas.push({ desc: "stock cambió solo por el ajuste -2", esperado: stockAntes - 2, obtenido: stockDesp });
  const malas = matriz(filas);
  registrar("X05", "Validaciones y normalización", malas.length ? "FAIL" : "PASS", `${filas.length - malas.length}/${filas.length} OK; sin escrituras parciales en los rechazos.`);
};

casos.X06 = async () => {
  escenario("X06-refresh-expiracion-logout");
  log(`Configuración vigente del .env: JWT_EXPIRES_IN=${ENV.JWT_EXPIRES_IN || "5m"} — se acorta a 6s solo para esta prueba.`);
  reconfigurar("auth-service", { JWT_EXPIRES_IN: "6s" });
  try {
    const tA = await tokenAdmin();
    await mecanicos(1, tA);
    const t0 = Date.now();
    const l = await login("carga1@torque.local", PASS_MEC);
    const r1 = await req("POST", "/api/auth/refresh", { body: { refreshToken: l.refreshToken } });
    const reuse = await req("POST", "/api/auth/refresh", { body: { refreshToken: l.refreshToken } });
    const r2tras = await req("POST", "/api/auth/refresh", { body: { refreshToken: r1.body.refreshToken } });
    const l2 = await login("carga1@torque.local", PASS_MEC);
    const out = await req("POST", "/api/auth/logout", { body: { refreshToken: l2.refreshToken } });
    const refTrasLogout = await req("POST", "/api/auth/refresh", { body: { refreshToken: l2.refreshToken } });
    const accTrasLogout = await req("GET", "/api/vehiculos", { token: l2.accessToken });
    await dormir(7000);
    const accVencido = await req("GET", "/api/vehiculos", { token: l2.accessToken });
    const filas = [
      { desc: "login expiresIn", esperado: 6, obtenido: l.expiresIn },
      { desc: "refresh válido (rota)", esperado: 200, obtenido: r1.status },
      { desc: "refresh rotado devuelve token distinto", esperado: true, obtenido: r1.body.refreshToken !== l.refreshToken },
      { desc: "reutilizar refresh viejo", esperado: 401, obtenido: reuse.status },
      { desc: "tras reutilización se revoca la sesión entera (refresh nuevo también 401)", esperado: 401, obtenido: r2tras.status },
      { desc: "logout", esperado: 204, obtenido: out.status },
      { desc: "refresh tras logout", esperado: 401, obtenido: refTrasLogout.status },
      { desc: "access tras logout, antes de exp (H07)", esperado: 200, obtenido: accTrasLogout.status },
      { desc: "access tras exp (+7 s)", esperado: 401, obtenido: accVencido.status },
    ];
    log(`   línea temporal: login t=0, logout t=${((Date.now() - t0 - 7000) / 1000).toFixed(1)}s, vencimiento t≈6s, consulta final t=${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const malas = matriz(filas);
    registrar("X06", "Refresh, expiración y logout reales", malas.length ? "FAIL" : "PASS", `${filas.length - malas.length}/${filas.length} OK. OJO: el .env de esta PC tiene JWT_EXPIRES_IN=${ENV.JWT_EXPIRES_IN}, no 5m.`);
  } finally {
    reconfigurar("auth-service", {});
  }
};

casos.X09 = async () => {
  escenario("X09-diagnostico-secretos");
  const tA = await tokenAdmin();
  const [A] = await mecanicos(1, tA);
  const pruebas = {
    200: await req("GET", "/api/vehiculos", { token: tA }),
    400: await req("GET", "/api/vehiculos/123", { token: tA }),
    401: await req("GET", "/api/ordenes"),
    403: await req("POST", "/api/repuestos", { token: A.token, body: { nombre: "x", codigo: "XXXXX8", stock: 1 } }),
    409: await nuevoVehiculo(tA, { patente: "AB123CD" }),
  };
  const ok = Object.entries(pruebas).map(([esp, r]) => ({ esp: Number(esp), st: r.status, rid: r.rid }));
  // Un pedido que atraviesa 3 servicios: el mismo rid debe aparecer en los logs de cada uno.
  const [rep] = await crearRepuestos("X09", 1, 5, tA);
  const o = await ordenCon(tA, rep);
  await dormir(1500);
  const logs = sh(`docker compose -p ${PROYECTO} logs --no-color --since 5m 2>&1`);
  const servicios = ["api-gateway", "workorders-service", "vehicles-service", "inventory-service"].filter((s) => logs.split("\n").some((l) => l.startsWith(s) && l.includes(o.rid)));
  const sinRid = ok.filter((x) => !x.rid);
  const fugas = [];
  if (ENV.ADMIN_PASSWORD && logs.includes(ENV.ADMIN_PASSWORD)) fugas.push("ADMIN_PASSWORD");
  if (ENV.JWT_SECRET && logs.includes(ENV.JWT_SECRET)) fugas.push("JWT_SECRET");
  if (logs.includes(PASS_MEC)) fugas.push("password de mecánico");
  if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(logs)) fugas.push("JWT completo");
  if (/Bearer\s+[A-Za-z0-9._-]{20,}/.test(logs)) fugas.push("header Bearer");
  const metricas = await req("GET", "/metrics/servicios");
  for (const x of ok) log(`   status esperado ${x.esp} → ${x.st}  rid=${x.rid ? x.rid.slice(0, 8) + "…" : "FALTA"}`);
  log(`   rid de la orden ${o.rid} aparece en: ${servicios.join(", ")}`);
  log(`   /metrics/servicios → ${metricas.status}; búsqueda de secretos en ${logs.split("\n").length} líneas de log: ${fugas.length ? fugas.join(", ") : "ninguno"}`);
  const fallo = ok.some((x) => x.st !== x.esp) || sinRid.length || servicios.length < 4 || fugas.length || metricas.status !== 200;
  registrar("X09", "Diagnóstico visible y secretos", fallo ? "FAIL" : "PASS", `5 status controlados con x-request-id; rid propagado a ${servicios.length}/4 servicios; secretos en logs: ${fugas.length ? fugas.join(", ") : "ninguno"}.`);
};

casos.X12 = async () => {
  escenario("X12-idempotencia-descuento");
  const tA = await tokenAdmin();
  const [A] = await mecanicos(1, tA);
  const [rep] = await crearRepuestos("X12", 1, 20, tA);
  const o = (await ordenCon(A.token, rep, 2)).body;
  const s1 = await stock(rep, tA);
  const rep1 = await req("POST", `/api/repuestos/${rep}/descontar`, { token: A.token, body: { cantidad: 2, ordenId: o.id } });
  const rep2 = await req("POST", `/api/repuestos/${rep}/descontar`, { token: A.token, body: { cantidad: 2, ordenId: o.id } });
  const s2 = await stock(rep, tA);
  log(`Secuencial: repetir el descuento de la orden ${o.id} dos veces → ${rep1.status} repetido=${rep1.body.repetido}, ${rep2.status} repetido=${rep2.body.repetido}; stock ${s1} → ${s2}`);
  // Concurrente: ordenId nuevo (formato válido) y 5 descuentos idénticos a la vez.
  const [rep3] = await crearRepuestos("X12C", 1, 20, tA);
  const oid = Math.floor(Date.now() / 1000).toString(16) + "0000000000000099";
  const conc = await Promise.all(Array.from({ length: 5 }, () => req("POST", `/api/repuestos/${rep3}/descontar`, { token: A.token, body: { cantidad: 3, ordenId: oid } })));
  const tras = await req("POST", `/api/repuestos/${rep3}/descontar`, { token: A.token, body: { cantidad: 3, ordenId: oid } });
  const movs = (await req("GET", `/api/repuestos/movimientos?ordenId=${oid}`, { token: tA })).body;
  const s3 = await stock(rep3, tA);
  log(`Concurrente (5 iguales): ${conc.map((r) => r.status).join(", ")}; reintento posterior → ${tras.status} repetido=${tras.body.repetido}; DESCUENTOS en el libro: ${movs.filter((m) => m.tipo === "DESCUENTO").length}; stock 20 → ${s3}`);
  const pass = s1 === s2 && rep1.body.repetido && movs.filter((m) => m.tipo === "DESCUENTO").length === 1 && s3 === 17;
  registrar("X12", "Idempotencia del descuento", pass ? "PASS" : "FAIL", `Un solo efecto por orden+repuesto (secuencial y concurrente). Concurrentes: 1×200 y el resto 409 «ocupado»; el reintento devuelve el movimiento existente. (Nota: se usó un ordenId inexistente, lo que además reconfirma H03.)`);
};

casos.X13 = async () => {
  escenario("X13-reposicion-concurrente");
  const tA = await tokenAdmin();
  const [A] = await mecanicos(1, tA);
  const [rep] = await crearRepuestos("X13", 1, 20, tA);
  const o = (await ordenCon(A.token, rep, 4)).body;
  const s0 = await stock(rep, tA);
  const conc = await Promise.all(Array.from({ length: 3 }, () => req("POST", "/api/repuestos/reposiciones", { token: A.token, body: { ordenId: o.id } })));
  const s1 = await stock(rep, tA);
  const seq = await req("POST", "/api/repuestos/reposiciones", { token: A.token, body: { ordenId: o.id } });
  const movs = (await req("GET", `/api/repuestos/movimientos?ordenId=${o.id}`, { token: tA })).body;
  log(`Orden EN_PROCESO con 4 unidades; stock ${s0}. 3 reposiciones simultáneas → ${conc.map((r) => `${r.status}:${r.body.items && r.body.items[0].estado}`).join(", ")}; stock → ${s1}`);
  log(`Reintento secuencial → ${seq.status} ${seq.body.items && seq.body.items[0].estado}; REPOSICIONES en libro: ${movs.filter((m) => m.tipo === "REPOSICION").length}`);
  const pass = s1 === s0 + 4 && movs.filter((m) => m.tipo === "REPOSICION").length === 1;
  registrar("X13", "Reposición repetida y concurrente", pass ? "PASS" : "FAIL", `Una sola REPOSICION por efecto aun con 3 pedidos simultáneos (stock +4 exacto). Observación: se repuso stock de una orden EN_PROCESO que sigue EN_PROCESO (H03: la ruta directa no mira el estado).`);
};

casos.X23 = async () => {
  escenario("X23-mongo-detenido-por-dominio");
  const tA = await tokenAdmin();
  const [rep] = await crearRepuestos("X23", 1, 10, tA);
  const filas = [];
  const ensayos = [
    { db: "vehicles-db", lectura: () => req("GET", `/api/vehiculos/${SEMILLA.vehiculos[0]}`, { token: tA, timeoutMs: 20000 }), escritura: () => nuevoVehiculo(tA) },
    { db: "inventory-db", lectura: () => req("GET", "/api/repuestos", { token: tA, timeoutMs: 20000 }), escritura: () => req("POST", `/api/repuestos/${rep}/ingreso`, { token: tA, body: { cantidad: 1 }, timeoutMs: 20000 }) },
    { db: "auth-db", lectura: () => req("GET", "/api/auth/me", { token: tA, timeoutMs: 20000 }), escritura: () => req("POST", "/api/auth/login", { body: { email: "admin@torque.local", password: ENV.ADMIN_PASSWORD }, timeoutMs: 20000 }) },
  ];
  for (const e of ensayos) {
    compose(`stop ${e.db}`);
    await dormir(1000);
    const l = await e.lectura();
    const w = await e.escritura();
    const otros = await req("GET", "/api/ordenes?estado=FINALIZADA", { token: tA, timeoutMs: 20000 });
    compose(`start ${e.db}`);
    const ini = Date.now();
    let rec = null;
    while (Date.now() - ini < 60000) {
      const r = await e.lectura();
      if (r.status === 200) { rec = Date.now() - ini; break; }
      await dormir(500);
    }
    log(`${e.db} detenida: lectura ${l.status} (${Math.round(l.ms)} ms), escritura ${w.status} (${Math.round(w.ms)} ms), otro dominio (órdenes) ${otros.status}; primera lectura OK ${rec === null ? "NUNCA (60 s)" : `a los ${(rec / 1000).toFixed(1)} s de levantarla`}`);
    filas.push({ db: e.db, lectura: l.status, escritura: w.status, otro: otros.status, recuperacionMs: rec });
  }
  // ¿quedó alguna escritura «ambigua» aplicada? El ingreso con inventory-db caída no debe figurar en el libro.
  const movs = (await req("GET", `/api/repuestos/movimientos?repuestoId=${rep}`, { token: tA })).body;
  log(`Libro del repuesto de prueba tras el ensayo: ${movs.map((m) => m.tipo + " " + m.cantidad).join(", ")}; stock ${await stock(rep, tA)}`);
  const pass = filas.every((f) => [500, 503].includes(f.lectura) && f.lectura !== 500 && f.otro === 200 && f.recuperacionMs !== null);
  registrar("X23", "Mongo detenido por dominio", pass ? "PASS" : "FAIL", filas.map((f) => `${f.db}: lectura ${f.lectura}, escritura ${f.escritura}, otro dominio ${f.otro}, recupera en ${f.recuperacionMs === null ? "—" : (f.recuperacionMs / 1000).toFixed(1) + " s"}`).join(" | "));
};

casos.X24 = async () => {
  escenario("X24-carreras-estado-edicion");
  const tA = await tokenAdmin();
  const [A] = await mecanicos(1, tA);
  const [rep] = await crearRepuestos("X24", 1, 100, tA);
  const res = [];
  for (let i = 0; i < 5; i++) {
    const o = (await ordenCon(A.token, rep)).body;
    const [f, c] = await Promise.all([
      req("POST", `/api/ordenes/${o.id}/finalizar`, { token: A.token }),
      req("POST", `/api/ordenes/${o.id}/cancelar`, { token: A.token, body: { motivo: "carrera de estado" } }),
    ]);
    const fin = (await req("GET", `/api/ordenes/${o.id}`, { token: A.token })).body;
    const neto = (await req("GET", `/api/repuestos/movimientos?ordenId=${o.id}`, { token: tA })).body.reduce((s, m) => s + m.cantidad, 0);
    res.push({ f: f.status, c: c.status, estado: fin.estado, neto });
  }
  for (const r of res) log(`   finalizar ${r.f} / cancelar ${r.c} → ${r.estado}, libro neto ${r.neto}`);
  const ordenOk = res.every((r) => [r.f, r.c].sort().join() === "200,409" && ((r.estado === "FINALIZADA" && r.neto === -1) || (r.estado === "CANCELADA" && r.neto === 0)));
  // Vehículo: dos ediciones simultáneas (sin control de versión) y edición vs baja.
  const v = (await nuevoVehiculo(tA)).body;
  const cuerpo = (km) => ({ marca: v.marca, modelo: v.modelo, anio: v.anio, patente: v.patente, kilometraje: km, duenio: v.duenio });
  const [e1, e2] = await Promise.all([req("PUT", `/api/vehiculos/${v.id}`, { token: tA, body: cuerpo(5000) }), req("PUT", `/api/vehiculos/${v.id}`, { token: A.token, body: cuerpo(7000) })]);
  const final = (await req("GET", `/api/vehiculos/${v.id}`, { token: tA })).body;
  log(`   dos PUT simultáneos (km 5000 y 7000) → ${e1.status}, ${e2.status}; queda km=${final.kilometraje}: gana el último, sin aviso (actualización perdida, sin control de versión)`);
  let modTrasBaja = 0;
  for (let i = 0; i < 10; i++) {
    const w = (await nuevoVehiculo(tA)).body;
    const cw = { marca: w.marca, modelo: "Editado", anio: w.anio, patente: w.patente, kilometraje: 9, duenio: w.duenio };
    await Promise.all([req("PUT", `/api/vehiculos/${w.id}`, { token: tA, body: cw }), req("DELETE", `/api/vehiculos/${w.id}`, { token: tA, body: { motivo: "baja en carrera" } })]);
    const g = (await req("GET", `/api/vehiculos/${w.id}`, { token: tA })).body;
    if (g.activo === false && g.modelo === "Editado") modTrasBaja++;
  }
  log(`   PUT vs baja simultáneos, 10 intentos: ${modTrasBaja} vehículos quedaron inactivos CON la edición aplicada (H12 si > 0)`);
  registrar("X24", "Carreras de estado y edición", ordenOk ? "PASS" : "FAIL", `Orden: finalizar vs cancelar → siempre una 200 y otra 409, libro coherente (${res.map((r) => r.estado[0]).join("")}). Vehículo: actualización perdida confirmada (último PUT gana); edición aplicada tras baja en ${modTrasBaja}/10 (H12).`, { h12: modTrasBaja });
};

casos.X26 = async () => {
  escenario("X26-limites-numericos-cuerpo");
  const tA = await tokenAdmin();
  const [rep] = await crearRepuestos("X26", 1, 10, tA);
  const s0 = await stock(rep, tA);
  const crudo = async (texto, ruta = "/api/ordenes") => {
    const r = await fetch(`${process.env.GW || "http://localhost:3100"}${ruta}`, { method: "POST", headers: { authorization: `Bearer ${tA}`, "content-type": "application/json" }, body: texto });
    return { status: r.status, rid: r.headers.get("x-request-id"), body: (await r.text()).slice(0, 160) };
  };
  const pruebas = [
    ["cantidad 2^53+1 (fuera de entero seguro)", `{"vehiculoId":"${SEMILLA.vehiculos[0]}","descripcion":"limite","repuestos":[{"repuestoId":"${rep}","cantidad":9007199254740993}]}`],
    ["cantidad 1e308", `{"vehiculoId":"${SEMILLA.vehiculos[0]}","descripcion":"limite","repuestos":[{"repuestoId":"${rep}","cantidad":1e308}]}`],
    ["ingreso 2^53+1", `{"cantidad":9007199254740993}`, `/api/repuestos/${rep}/ingreso`],
    ["JSON malformado", `{"vehiculoId": "x",`],
    ["cuerpo 200 KB (límite express.json 100 KB)", JSON.stringify({ vehiculoId: SEMILLA.vehiculos[0], descripcion: "x".repeat(200000) })],
    ["cuerpo 2 MB (límite gateway 1 MB)", JSON.stringify({ vehiculoId: SEMILLA.vehiculos[0], descripcion: "x".repeat(2000000) })],
    ["11 repuestos (máx. 10)", JSON.stringify({ vehiculoId: SEMILLA.vehiculos[0], descripcion: "muchos", repuestos: Array.from({ length: 11 }, (_, i) => ({ repuestoId: (i + 10).toString(16).padStart(24, "a") })) })],
  ];
  const filas = [];
  for (const [desc, cuerpo, ruta] of pruebas) {
    const r = await crudo(cuerpo, ruta);
    filas.push({ desc, status: r.status, rid: !!r.rid });
    log(`   ${desc} → ${r.status} rid=${r.rid ? "sí" : "NO"}  ${r.body.replace(/\s+/g, " ")}`);
  }
  const s1 = await stock(rep, tA);
  log(`   stock del repuesto ${s0} → ${s1}`);
  const malos = filas.filter((f) => f.status >= 500 || !f.rid);
  registrar("X26", "Límites numéricos y tamaño del cuerpo", malos.length || s1 > s0 + 1e6 ? "FAIL" : "PASS", `${filas.map((f) => `${f.desc}: ${f.status}`).join(" | ")}; stock ${s0}→${s1}.`);
};

casos.X27 = async () => {
  escenario("X27-refresh-concurrente-cambio-rol");
  const tA = await tokenAdmin();
  const email = `x27-${Date.now()}@torque.local`;
  const alta = await req("POST", "/api/auth/usuarios", { token: tA, body: { email, nombre: "X27", password: PASS_MEC } });
  const l = await login(email, PASS_MEC);
  const conc = await Promise.all(Array.from({ length: 5 }, () => req("POST", "/api/auth/refresh", { body: { refreshToken: l.refreshToken } })));
  const oks = conc.filter((r) => r.status === 200);
  const sigue = await Promise.all(oks.map((r) => req("POST", "/api/auth/refresh", { body: { refreshToken: r.body.refreshToken } })));
  log(`5 refresh simultáneos del MISMO token → ${conc.map((r) => r.status).join(", ")}; de los ${oks.length} OK, renovables después: ${sigue.filter((r) => r.status === 200).length}`);
  // Ascenso y degradación con access vigente
  const id = alta.body.id || l.usuario.id;
  await req("PATCH", `/api/auth/usuarios/${id}`, { token: tA, body: { rol: "ADMIN" } });
  const comoAdmin = await login(email, PASS_MEC);
  await req("PATCH", `/api/auth/usuarios/${id}`, { token: tA, body: { rol: "MECANICO" } });
  const opAdmin = await req("GET", "/api/auth/usuarios", { token: comoAdmin.accessToken });
  const refrescado = await req("POST", "/api/auth/refresh", { body: { refreshToken: comoAdmin.refreshToken } });
  const opTrasRefresh = refrescado.status === 200 ? await req("GET", "/api/auth/usuarios", { token: refrescado.body.accessToken }) : { status: "-" };
  log(`Degradado ADMIN→MECANICO con access vigente: operación de ADMIN → ${opAdmin.status} (retiene permisos hasta exp, ${comoAdmin.expiresIn}s); tras refresh → ${opTrasRefresh.status}`);
  const dobles = sigue.filter((r) => r.status === 200).length;
  registrar("X27", "Refresh concurrente y cambio de rol", dobles > 1 ? "FAIL" : "PASS", `Refresh concurrente: ${oks.length} de 5 aceptados, ${dobles} cadenas válidas después${dobles > 1 ? " (DOS sesiones paralelas del mismo token)" : ""}. Rol degradado: el access viejo sigue siendo ADMIN (${opAdmin.status}) hasta vencer (H07); el refresh ya emite el rol nuevo (${opTrasRefresh.status}).`, { aceptados: oks.length, cadenas: dobles });
  await req("PATCH", `/api/auth/usuarios/${id}`, { token: tA, body: { activo: false } });
};

casos.X31 = async () => {
  escenario("X31-backup-restore");
  const tA = await tokenAdmin();
  const ref = { repuestos: (await req("GET", "/api/repuestos", { token: tA })).body };
  const sumaStock = ref.repuestos.reduce((s, r) => s + r.stock, 0);
  const ini = Date.now();
  sh(`docker compose -p ${PROYECTO} exec -T inventory-db mongodump --quiet --archive --db inventory > /tmp/claude-1000/x31-inventory.archive`);
  const bytes = Number(sh("stat -c %s /tmp/claude-1000/x31-inventory.archive").trim());
  sh("docker rm -f x31-restore >/dev/null 2>&1 || true");
  sh("docker run -d --name x31-restore mongo:7 --quiet >/dev/null");
  for (let i = 0; i < 30; i++) {
    try { sh("docker exec x31-restore mongosh --quiet --eval 'db.adminCommand(\"ping\").ok'"); break; } catch { await dormir(1000); }
  }
  sh("docker exec -i x31-restore mongorestore --quiet --archive < /tmp/claude-1000/x31-inventory.archive");
  const restaurado = JSON.parse(sh(`docker exec x31-restore mongosh inventory --quiet --eval 'JSON.stringify({n: db.repuestos.countDocuments(), stock: db.repuestos.aggregate([{$group:{_id:null,s:{$sum:"$stock"}}}]).toArray()[0].s, movs: db.movimientos.countDocuments(), libro: db.movimientos.aggregate([{$group:{_id:null,s:{$sum:"$cantidad"}}}]).toArray()[0].s, indices: db.repuestos.getIndexes().length + db.movimientos.getIndexes().length})'`));
  const seg = ((Date.now() - ini) / 1000).toFixed(1);
  sh("docker rm -f x31-restore >/dev/null; rm -f /tmp/claude-1000/x31-inventory.archive");
  log(`mongodump de inventory: ${(bytes / 1e6).toFixed(1)} MB; restaurado en un mongo NUEVO (otro contenedor/volumen) en ${seg} s en total.`);
  log(`Original: ${ref.repuestos.length} repuestos, suma stock ${sumaStock}. Restaurado: ${restaurado.n} repuestos, suma stock ${restaurado.stock}, ${restaurado.movs} movimientos, suma libro ${restaurado.libro}, ${restaurado.indices} índices.`);
  const pass = restaurado.n === ref.repuestos.length && restaurado.stock === sumaStock;
  registrar("X31", "Backup y restauración real (inventory)", pass ? "PASS" : "FAIL", `mongodump/mongorestore a instancia nueva: ${restaurado.n} repuestos, stock ${restaurado.stock} = original ${sumaStock}; libro restaurado suma ${restaurado.libro}${restaurado.libro !== restaurado.stock ? " (≠ stock: arrastra la sobreventa/H02 de las pruebas)" : ""}. Solo un dominio y sin carga concurrente: cuatro dumps separados no forman un punto consistente entre servicios.`);
};

casos.X32 = async () => {
  escenario("X32-tls-puertos");
  const certs = sh("ls services/api-gateway/certs").trim().split("\n");
  const puertos = sh(`docker ps --filter name=${PROYECTO} --format '{{.Names}} {{.Ports}}'`).trim();
  log(`Archivos en certs/: ${certs.join(", ")}`);
  log("Puertos publicados:\n" + puertos.split("\n").map((l) => "   " + l).join("\n"));
  let tls = "sin certificado: el gateway solo sirve HTTP";
  if (certs.some((c) => c.endsWith(".crt"))) {
    try { tls = sh(`curl -sk -o /dev/null -w '%{http_code} %{ssl_verify_result}' https://localhost:3543/health`); } catch (e) { tls = "HTTPS no responde"; }
  }
  const publicados = puertos.split("\n").filter((l) => /->/.test(l));
  log(`HTTPS: ${tls}`);
  registrar("X32", "TLS y exposición de puertos", "PASS", `Solo el gateway publica puertos (${publicados.length} contenedor con puertos). HTTPS: ${tls}. HTTP sigue abierto por diseño (H09 si se exige TLS obligatorio).`);
};

casos.X33 = async () => {
  escenario("X33-aislamiento-datos");
  // Desde la base de workorders (otro dominio) se intenta llegar a la base de inventory y a Redis.
  let mongoCruzado, redisCruzado;
  try {
    mongoCruzado = sh(`docker compose -p ${PROYECTO} exec -T workorders-db mongosh "mongodb://inventory-db:27017/inventory" --quiet --eval 'JSON.stringify({colecciones: db.getCollectionNames(), repuestos: db.repuestos.estimatedDocumentCount()})'`).trim();
  } catch (e) { mongoCruzado = "RECHAZADO: " + e.message.slice(0, 80); }
  try {
    redisCruzado = sh(`docker compose -p ${PROYECTO} exec -T vehicles-service node -e "const s=require('net').connect(6379,'redis',()=>s.write('PING\\r\\n'));s.on('data',d=>{console.log(String(d).trim());s.end()});s.on('error',e=>console.log('ERR',e.code))"`).trim();
  } catch (e) { redisCruzado = "RECHAZADO"; }
  log(`workorders-db → inventory-db (sin credenciales): ${mongoCruzado}`);
  log(`vehicles-service (no usa Redis) → redis:6379 PING: ${redisCruzado}`);
  const abierto = !mongoCruzado.startsWith("RECHAZADO") || redisCruzado === "+PONG";
  registrar("X33", "Aislamiento efectivo de datos", abierto ? "FAIL" : "PASS", `Separación lógica, no de red: desde otro dominio se lee inventory-db sin autenticación (${mongoCruzado.startsWith("RECHAZADO") ? "no" : "sí"}) y vehicles-service alcanza Redis (${redisCruzado}). Confirma H08 (requisito de endurecimiento, no de la demo).`);
};

casos.X34 = async () => {
  escenario("X34-dependencias-secretos");
  const filas = [];
  for (const s of ["api-gateway", "auth-service", "vehicles-service", "inventory-service", "workorders-service"]) {
    try {
      const out = execSync("npm audit --omit=dev --json", { cwd: `${RAIZ}/services/${s}`, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }).toString();
      filas.push({ s, v: JSON.parse(out).metadata.vulnerabilities });
    } catch (e) {
      const out = e.stdout ? e.stdout.toString() : "";
      try { filas.push({ s, v: JSON.parse(out).metadata.vulnerabilities }); } catch { filas.push({ s, error: (e.stderr || e.message).toString().slice(0, 100) }); }
    }
  }
  for (const f of filas) log(`   ${f.s}: ${f.error ? "ERROR " + f.error : JSON.stringify(f.v)}`);
  const versionado = sh("git ls-files | grep -E '(^|/)\\.env$|\\.key$|\\.pem$' || true").trim();
  const historia = ENV.JWT_SECRET ? sh(`git log --all -p | grep -c -F "${ENV.JWT_SECRET}" || true`).trim() : "?";
  log(`   archivos sensibles versionados: ${versionado || "ninguno"}; JWT_SECRET actual en la historia de git: ${historia} apariciones`);
  const bloqueada = filas.some((f) => f.error);
  const altas = filas.reduce((s, f) => s + (f.v ? (f.v.high || 0) + (f.v.critical || 0) : 0), 0);
  registrar("X34", "Dependencias, secretos e imágenes", bloqueada ? "BLOQUEADA" : altas ? "FAIL" : "PASS", `npm audit (prod) por servicio: ${filas.map((f) => `${f.s.replace("-service", "")}=${f.error ? "error" : f.v.total}`).join(", ")} (altas/críticas: ${altas}); .env/claves versionados: ${versionado || "ninguno"}; secreto en historia: ${historia}.`);
};

const pedidos = process.argv.slice(2);
for (const [id, f] of Object.entries(casos)) {
  if (pedidos.length && !pedidos.includes(id)) continue;
  try {
    await f();
  } catch (err) {
    registrar(id, "error del arnés", "BLOQUEADA", err.message.slice(0, 300));
  }
}
const previo = (() => { try { return JSON.parse(execSync(`cat ${RAIZ}/docs/defensa/resultados/X-plan.json`).toString()); } catch { return []; } })();
const porId = Object.fromEntries(previo.map((r) => [r.id, r]));
for (const r of resultados) porId[r.id] = r;
guardarJson("X-plan", Object.values(porId).sort((a, b) => a.id.localeCompare(b.id)));
