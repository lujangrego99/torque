// Arnés mínimo para las pruebas de la defensa: HTTP con medición, generador de
// carga por usuarios virtuales, control de Docker Compose e invariantes.
// Sin dependencias: Node >= 18 (fetch nativo).
import { execSync, exec } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const GW = process.env.GW || "http://localhost:3100";
export const PROYECTO = process.env.PROYECTO || "torque-defensa";
// El panel manda su salida a otra carpeta para no pisar la evidencia de la defensa.
export const SALIDA = process.env.SALIDA || join(RAIZ, "docs", "defensa", "resultados");
mkdirSync(SALIDA, { recursive: true });

// --- .env (la contraseña del admin nunca se imprime) ----------------------
function leerEnv() {
  const env = {};
  for (const linea of readFileSync(join(RAIZ, ".env"), "utf8").split("\n")) {
    const m = linea.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return env;
}
export const ENV = leerEnv();
export const ADMIN = { email: ENV.ADMIN_EMAIL || "admin@torque.local", password: ENV.ADMIN_PASSWORD };
export const PASS_MEC = "clave-de-prueba-1";

// Datos semilla (mismos ids que scripts/pruebas-correcciones.sh)
export const SEMILLA = {
  vehiculos: ["68c000000000000000000001", "68c000000000000000000002"],
  repuestos: ["68c000000000000000000011", "68c000000000000000000012", "68c000000000000000000013"],
};

// --- Registro de salida ---------------------------------------------------
let archivoActual = null;
export function escenario(nombre) {
  archivoActual = join(SALIDA, `${nombre}.txt`);
  writeFileSync(archivoActual, `# ${nombre} — ${new Date().toISOString()} — gateway ${GW}\n`);
  log(`\n################ ${nombre}`);
}
export function log(...partes) {
  const t = partes.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  console.log(t);
  if (archivoActual) appendFileSync(archivoActual, t + "\n");
}
export function guardarJson(nombre, datos) {
  writeFileSync(join(SALIDA, `${nombre}.json`), JSON.stringify(datos, null, 2));
}

// --- HTTP -------------------------------------------------------------------
export async function req(metodo, ruta, { token, body, timeoutMs = 30000 } = {}) {
  const inicio = performance.now();
  try {
    const r = await fetch(GW + ruta, {
      method: metodo,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const texto = await r.text();
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = { texto };
    }
    return { status: r.status, body: json, ms: performance.now() - inicio, rid: r.headers.get("x-request-id") };
  } catch (err) {
    const status = err.name === "TimeoutError" ? "TIMEOUT" : `ERR_${(err.cause && err.cause.code) || err.name}`;
    return { status, body: null, ms: performance.now() - inicio };
  }
}

export async function login(email, password) {
  const r = await req("POST", "/api/auth/login", { body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
export const tokenAdmin = async () => (await login(ADMIN.email, ADMIN.password)).accessToken;

// Crea (si no existen) mecánicos mec-<n>@torque.local y devuelve sus tokens.
export async function mecanicos(n, tAdmin) {
  const tokens = [];
  for (let i = 1; i <= n; i++) {
    const email = `carga${i}@torque.local`;
    await req("POST", "/api/auth/usuarios", { token: tAdmin, body: { email, nombre: `Carga ${i}`, password: PASS_MEC } });
    const l = await login(email, PASS_MEC);
    tokens.push({ email, token: l.accessToken, refresh: l.refreshToken, id: l.usuario && l.usuario.id });
  }
  return tokens;
}

// Alta de repuestos de prueba con stock inicial. Devuelve sus ids.
export async function crearRepuestos(prefijo, n, stock, tAdmin) {
  const ids = [];
  const lote = Math.random().toString(36).slice(2, 8).toUpperCase();
  for (let i = 0; i < n; i++) {
    const codigo = `T${lote}-${i}`; // 5-20 caracteres A-Z, 0-9, guion
    const r = await req("POST", "/api/repuestos", { token: tAdmin, body: { nombre: `Prueba ${prefijo} ${codigo}`, codigo, stock } });
    if (r.status !== 201) throw new Error(`alta repuesto → ${r.status} ${JSON.stringify(r.body)}`);
    ids.push(r.body.item.id);
  }
  return ids;
}

// --- Estadística --------------------------------------------------------------
export function percentil(ordenados, p) {
  if (!ordenados.length) return null;
  const i = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return Math.round(ordenados[Math.max(0, i)]);
}
export function resumen(resultados, segundos) {
  const ms = resultados.map((r) => r.ms).sort((a, b) => a - b);
  const porStatus = {};
  for (const r of resultados) porStatus[r.status] = (porStatus[r.status] || 0) + 1;
  return {
    pedidos: resultados.length,
    rps: Math.round((resultados.length / segundos) * 10) / 10,
    p50: percentil(ms, 50),
    p95: percentil(ms, 95),
    p99: percentil(ms, 99),
    max: Math.round(ms[ms.length - 1] || 0),
    porStatus,
  };
}

// N usuarios virtuales, cada uno en bucle cerrado (pide, espera respuesta, vuelve a pedir)
// durante `segundos`. `fn(vu, iter)` hace UN pedido y devuelve el resultado de req().
export async function carga({ usuarios, segundos, fn }) {
  const fin = Date.now() + segundos * 1000;
  const resultados = [];
  const inicio = performance.now();
  await Promise.all(
    Array.from({ length: usuarios }, async (_, vu) => {
      let iter = 0;
      while (Date.now() < fin) resultados.push(await fn(vu, iter++));
    })
  );
  return resumen(resultados, (performance.now() - inicio) / 1000);
}

// Dispara `n` pedidos exactamente a la vez (ráfaga) y devuelve cada resultado.
export async function rafaga(n, fn) {
  const inicio = performance.now();
  const res = await Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
  return { res, segundos: (performance.now() - inicio) / 1000 };
}

// --- Docker -------------------------------------------------------------------
const envCompose = () => ({
  ...process.env,
  // El stack de la demo («torque») publica 3000/3443; el descartable, 3100/3543.
  GATEWAY_HTTP_PORT: process.env.GATEWAY_HTTP_PORT || (PROYECTO === "torque" ? "3000" : "3100"),
  GATEWAY_HTTPS_PORT: process.env.GATEWAY_HTTPS_PORT || (PROYECTO === "torque" ? "3443" : "3543"),
});
export function compose(args, extraEnv = {}) {
  return execSync(`docker compose -p ${PROYECTO} ${args}`, {
    cwd: RAIZ,
    env: { ...envCompose(), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
}
// Recrea un servicio con variables distintas (p. ej. DEMO_DELAY_MS=0) y espera healthy.
export function reconfigurar(servicio, extraEnv) {
  compose(`up -d --wait --no-deps ${servicio}`, extraEnv);
}
// Asíncrono: un execSync bloquearía al generador de carga y falsearía la latencia.
export async function stats() {
  const out = await new Promise((ok) =>
    exec(`docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'`, (e, so) => ok(so || ""))
  );
  return out
    .split("\n")
    .filter((l) => l.startsWith(PROYECTO))
    .map((l) => l.replace(`${PROYECTO}-`, "").replace(/-1\t/, "\t"))
    .join("\n");
}
export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Invariantes de negocio ---------------------------------------------------
// Para cada repuesto: stock == suma del libro de movimientos y stock >= 0.
// Para cada orden: el libro de inventory coincide con su estado.
export async function invariantes(tAdmin, { repuestos } = {}) {
  const problemas = [];
  const lista = (await req("GET", "/api/repuestos", { token: tAdmin })).body;
  const objetivo = repuestos ? lista.filter((r) => repuestos.includes(r.id)) : lista;
  for (const rep of objetivo) {
    const movs = (await req("GET", `/api/repuestos/movimientos?repuestoId=${rep.id}&limite=500`, { token: tAdmin })).body;
    const suma = movs.reduce((s, m) => s + m.cantidad, 0);
    if (movs.length < 500 && suma !== rep.stock) problemas.push(`${rep.codigo}: stock ${rep.stock} ≠ suma del libro ${suma}`);
    if (rep.stock < 0) problemas.push(`${rep.codigo}: STOCK NEGATIVO ${rep.stock}`);
  }
  const ordenes = (await req("GET", "/api/ordenes", { token: tAdmin })).body;
  const resumenEstados = {};
  for (const o of ordenes) {
    resumenEstados[o.estado] = (resumenEstados[o.estado] || 0) + 1;
    if (repuestos && !o.items.some((i) => repuestos.includes(i.repuestoId))) continue;
    const movs = (await req("GET", `/api/repuestos/movimientos?ordenId=${o.id}&limite=500`, { token: tAdmin })).body;
    const neto = movs.reduce((s, m) => s + m.cantidad, 0);
    const pedido = o.items.reduce((s, i) => s + i.cantidad, 0);
    if (["EN_PROCESO", "FINALIZADA"].includes(o.estado) && neto !== -pedido) problemas.push(`orden ${o.id} ${o.estado}: libro neto ${neto}, esperado ${-pedido}`);
    if (["FALLIDA", "CANCELADA"].includes(o.estado) && neto !== 0 && !(o.reposicion && o.reposicion.estado === "PENDIENTE"))
      problemas.push(`orden ${o.id} ${o.estado}: libro neto ${neto} (stock consumido sin reponer)`);
    if (o.estado === "PENDIENTE") problemas.push(`orden ${o.id} quedó PENDIENTE (huérfana); libro neto ${neto}`);
  }
  return { repuestosRevisados: objetivo.length, ordenesRevisadas: ordenes.length, estados: resumenEstados, problemas };
}
