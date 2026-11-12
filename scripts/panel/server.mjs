// Panel de control de Torque para la exposición.
//   node scripts/panel/server.mjs            → http://localhost:4000
// Solo escucha en 127.0.0.1 y solo ejecuta acciones de una lista cerrada
// (no hay comandos libres). Sin dependencias: Node >= 18.
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const PUERTO = Number(process.env.PANEL_PORT || 4000);
const SALIDA = join(AQUI, "salidas");
mkdirSync(SALIDA, { recursive: true });

// --- Destinos -----------------------------------------------------------------
const DESTINOS = {
  defensa: { proyecto: "torque-defensa", gw: "http://localhost:3100", http: "3100", https: "3543", etiqueta: "Pruebas (descartable, :3100)" },
  demo: { proyecto: "torque", gw: "http://localhost:3000", http: "3000", https: "3443", etiqueta: "Demo real (:3000)" },
};
let destino = DESTINOS[process.env.PANEL_DESTINO] ? process.env.PANEL_DESTINO : "defensa";
const D = () => DESTINOS[destino];
const overrides = { defensa: {}, demo: {} }; // variables cambiadas desde el panel (en memoria)

const SERVICIOS = ["api-gateway", "auth-service", "vehicles-service", "inventory-service", "workorders-service", "auth-db", "vehicles-db", "inventory-db", "workorders-db", "redis"];

const DUR = /^\d{1,6}(ms|s|m|h|d)?$/;
const ENT = (min, max) => (v) => /^\d{1,7}$/.test(v) && Number(v) >= min && Number(v) <= max;
const PERILLAS = {
  DEMO_DELAY_MS: { svc: "inventory-service", ok: ENT(0, 60000), ayuda: "Demora artificial dentro de la sección crítica (ms). Compose: 1000." },
  LOCK_TTL_MS: { svc: "inventory-service", ok: ENT(50, 600000), ayuda: "Vencimiento del lock de Redis (ms). Bajarlo a 300 reproduce H04." },
  LAB_ENDPOINTS: { svc: "inventory-service", ok: (v) => v === "true" || v === "false", opciones: ["false", "true"], ayuda: "Endpoints de laboratorio (reiniciar stock, descontar sin lock)." },
  JWT_EXPIRES_IN: { svc: "auth-service", ok: (v) => DUR.test(v), ayuda: "Vigencia del access token (5m, 12h…). Requiere login nuevo." },
  SESSION_IDLE: { svc: "auth-service", ok: (v) => DUR.test(v), ayuda: "Inactividad máxima de la sesión (refresh)." },
  BCRYPT_ROUNDS: { svc: "auth-service", ok: ENT(4, 15), ayuda: "Costo de bcrypt. 12 ≈ 0,6 s por login; 10 ≈ 4 veces más rápido." },
  INVENTORY_TIMEOUT_MS: { svc: "workorders-service", ok: ENT(50, 120000), ayuda: "Cuánto espera workorders a inventory. 400 con demora 1000 → ítem INCIERTO." },
  VEHICLES_TIMEOUT_MS: { svc: "workorders-service", ok: ENT(50, 120000), ayuda: "Cuánto espera workorders a vehicles." },
  PROXY_TIMEOUT_MS: { svc: "api-gateway", ok: ENT(100, 300000), ayuda: "Timeout del gateway hacia los servicios (15000)." },
};

// --- .env (los secretos no salen de este proceso) ------------------------------
function leerEnv() {
  const env = {};
  try {
    for (const l of readFileSync(join(RAIZ, ".env"), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {}
  return env;
}
const ADMIN = () => {
  const e = leerEnv();
  return { email: e.ADMIN_EMAIL || "admin@torque.local", password: e.ADMIN_PASSWORD };
};

// --- Docker ------------------------------------------------------------------
const envCompose = () => ({ ...process.env, GATEWAY_HTTP_PORT: D().http, GATEWAY_HTTPS_PORT: D().https, ...overrides[destino] });
function run(cmd, args, { env = process.env, timeout = 240000 } = {}) {
  return new Promise((ok) =>
    execFile(cmd, args, { cwd: RAIZ, env, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      ok({ code: err ? err.code || 1 : 0, stdout: String(stdout), stderr: String(stderr) })
    )
  );
}
const compose = (args, opts = {}) => run("docker", ["compose", "-p", D().proyecto, ...args], { env: envCompose(), ...opts });

let colaDocker = Promise.resolve(); // las mutaciones de Docker, de a una
const enCola = (f) => (colaDocker = colaDocker.then(f, f));

let statsCache = { destino: null, filas: {}, t: 0 };
async function refrescarStats() {
  const p = D().proyecto;
  const r = await run("docker", ["stats", "--no-stream", "--format", "{{json .}}"], { timeout: 20000 });
  const filas = {};
  for (const l of r.stdout.split("\n").filter(Boolean)) {
    try {
      const s = JSON.parse(l);
      if (s.Name.startsWith(p + "-")) filas[s.Name.slice(p.length + 1).replace(/-\d+$/, "")] = { cpu: s.CPUPerc, mem: s.MemUsage.split(" / ")[0] };
    } catch {}
  }
  statsCache = { destino, filas, t: Date.now() };
}
(async function bucleStats() {
  for (;;) {
    await refrescarStats().catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
  }
})();

// --- HTTP contra Torque ------------------------------------------------------
async function pedir(metodo, ruta, { token, body, timeoutMs = 20000 } = {}) {
  const ini = performance.now();
  try {
    const r = await fetch(D().gw + ruta, {
      method: metodo,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const texto = await r.text();
    let json;
    try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
    return { status: r.status, ms: Math.round(performance.now() - ini), rid: r.headers.get("x-request-id"), body: json };
  } catch (e) {
    return { status: e.name === "TimeoutError" ? "TIMEOUT" : `ERROR ${(e.cause && e.cause.code) || e.name}`, ms: Math.round(performance.now() - ini), body: null };
  }
}
const tokens = { defensa: {}, demo: {} };
async function token(rol) {
  const cache = tokens[destino];
  if (cache[rol] && cache[rol].exp > Date.now()) return cache[rol].t;
  let cred = ADMIN();
  if (rol === "MECANICO") {
    const tA = await token("ADMIN");
    cred = { email: "panel-mecanico@torque.local", password: "clave-de-prueba-1" };
    await pedir("POST", "/api/auth/usuarios", { token: tA, body: { email: cred.email, nombre: "Mecánico del panel", password: cred.password } });
  }
  const r = await pedir("POST", "/api/auth/login", { body: cred, timeoutMs: 30000 });
  if (r.status !== 200) throw new Error(`login ${rol} → ${r.status}`);
  cache[rol] = { t: r.body.accessToken, exp: Date.now() + Math.min(r.body.expiresIn * 1000 - 5000, 10 * 60000) };
  return cache[rol].t;
}

const CUENTAS_DEMO = {
  ADMIN: { email: "demo-admin@torque.local", password: "admin-demo-2026", nombre: "Admin de demo" },
  MECANICO: { email: "demo-mecanico@torque.local", password: "mecanico-demo-2026", nombre: "Mecánico de demo" },
};
const demoCache = { defensa: {}, demo: {} };
async function cuentaDemo(rol) {
  const c = CUENTAS_DEMO[rol], cache = demoCache[destino];
  if (cache[rol] && cache[rol].exp > Date.now()) return cache[rol].datos;
  let r = await pedir("POST", "/api/auth/login", { body: { email: c.email, password: c.password }, timeoutMs: 30000 });
  if (r.status === 401) {
    const alta = await pedir("POST", "/api/auth/usuarios", { token: await token("ADMIN"), body: { email: c.email, nombre: c.nombre, password: c.password, rol } });
    if (![201, 409].includes(alta.status)) throw new Error(`no se pudo crear ${c.email} (${alta.status})`);
    r = await pedir("POST", "/api/auth/login", { body: { email: c.email, password: c.password }, timeoutMs: 30000 });
  }
  if (r.status !== 200) throw new Error(`login ${c.email} → ${r.status}${r.status === 401 ? " (la cuenta existe con otra contraseña o está deshabilitada)" : ""}`);
  const datos = { como: rol, email: c.email, password: c.password, token: r.body.accessToken, venceEnSeg: r.body.expiresIn, rol: r.body.usuario ? r.body.usuario.rol : rol };
  cache[rol] = { datos, exp: Date.now() + Math.min(r.body.expiresIn * 1000 - 5000, 30 * 60000) };
  return datos;
}

// --- Trabajos (procesos hijos con salida en vivo) ------------------------------
const trabajos = new Map();
let siguienteId = 1;
function lanzar(titulo, cmd, args, extraEnv = {}) {
  const id = String(siguienteId++);
  const env = { ...envCompose(), GW: D().gw, PROYECTO: D().proyecto, COMPOSE_PROJECT_NAME: D().proyecto, SALIDA, FORCE_COLOR: "0", ...extraEnv };
  const proc = spawn(cmd, args, { cwd: RAIZ, env, detached: true });
  const t = { id, titulo, destino, inicio: Date.now(), fin: null, code: null, lineas: [], clientes: new Set(), proc };
  trabajos.set(id, t);
  const agregar = (texto) => {
    for (const l of texto.split("\n")) {
      if (l === "") continue;
      t.lineas.push(l);
      if (t.lineas.length > 5000) t.lineas.splice(0, 1000);
      for (const c of t.clientes) c.write(`data: ${JSON.stringify(l)}\n\n`);
    }
  };
  let resto = { out: "", err: "" };
  const flujo = (k) => (d) => {
    const s = resto[k] + d.toString();
    const i = s.lastIndexOf("\n");
    if (i >= 0) { agregar(s.slice(0, i)); resto[k] = s.slice(i + 1); } else resto[k] = s;
  };
  proc.stdout.on("data", flujo("out"));
  proc.stderr.on("data", flujo("err"));
  proc.on("close", (code) => {
    agregar(resto.out + "\n" + resto.err);
    t.fin = Date.now();
    t.code = code;
    for (const c of t.clientes) { c.write(`event: fin\ndata: ${JSON.stringify(code)}\n\n`); c.end(); }
    t.clientes.clear();
  });
  return t;
}
const nodo = (script, ...args) => ["node", [join(RAIZ, script), ...args]];
const n = (v, min, max, def) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : def; };

// Catálogo cerrado. invasivo: cambia datos/config o apaga cosas (en la demo pide confirmación).
const CATALOGO = {
  "exp:lectura": { titulo: (p) => `Lecturas · ${n(p.VU, 1, 2000, 50)} usuarios · ${n(p.SEG, 1, 300, 15)} s`, cmd: (p) => nodo("scripts/panel/experimento.mjs", "lectura"), env: (p) => ({ VU: String(n(p.VU, 1, 2000, 50)), SEG: String(n(p.SEG, 1, 300, 15)) }) },
  "exp:login": { titulo: (p) => `Logins simultáneos · ${n(p.N, 1, 300, 20)}`, cmd: () => nodo("scripts/panel/experimento.mjs", "login"), env: (p) => ({ N: String(n(p.N, 1, 300, 20)) }) },
  "exp:ordenes": { invasivo: true, titulo: (p) => `Órdenes · ${n(p.VU, 1, 500, 20)} usuarios · ${n(p.SEG, 1, 300, 15)} s`, cmd: () => nodo("scripts/panel/experimento.mjs", "ordenes"), env: (p) => ({ VU: String(n(p.VU, 1, 500, 20)), SEG: String(n(p.SEG, 1, 300, 15)) }) },
  "exp:mismo": { invasivo: true, titulo: (p) => `Mismo repuesto · ${n(p.N, 1, 500, 20)} a la vez · stock ${n(p.STOCK, 0, 100000, 5)}`, cmd: () => nodo("scripts/panel/experimento.mjs", "mismo"), env: (p) => ({ N: String(n(p.N, 1, 500, 20)), STOCK: String(n(p.STOCK, 0, 100000, 5)) }) },
  "exp:invariantes": { titulo: () => "Invariantes (stock = libro, nada negativo, órdenes coherentes)", cmd: () => nodo("scripts/panel/experimento.mjs", "invariantes") },
  ensayo: { invasivo: true, titulo: () => "Ensayo de la demo (crea 2 órdenes)", cmd: () => nodo("scripts/defensa/ensayo-demo.mjs") },
  sesion: { invasivo: true, titulo: () => "Vencimiento de sesión escalado (≈2 min)", cmd: () => nodo("scripts/defensa/sesion.mjs") },
};
for (const k of ["h02", "h03", "h04", "h07", "h15"]) CATALOGO[`carrera:${k}`] = { invasivo: true, titulo: () => `Carrera ${k.toUpperCase()}`, cmd: () => nodo("scripts/defensa/carreras.mjs", k) };
for (const k of ["auth", "inventory", "redis", "vehicles", "wodb", "killwo", "killinv", "timeout", "reinicio"]) CATALOGO[`caos:${k}`] = { invasivo: true, titulo: () => `Caída: ${k}`, cmd: () => nodo("scripts/defensa/caos.mjs", k) };
for (const k of ["tp6", "tp7", "correcciones"]) CATALOGO[`suite:${k}`] = { invasivo: true, titulo: () => `Suite ${k}`, cmd: () => ["bash", [join(RAIZ, `scripts/pruebas-${k}.sh`)]] };

// --- API ---------------------------------------------------------------------
const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };
const leerCuerpo = (req) => new Promise((ok) => { let d = ""; req.on("data", (c) => { d += c; if (d.length > 1e6) req.destroy(); }); req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch { ok({}); } }); });
const exigirConfirmacion = (p) => destino === "demo" && !p.confirmar;

async function estado() {
  const ps = await compose(["ps", "-a", "--format", "json"], { timeout: 20000 });
  let filas = [];
  const txt = ps.stdout.trim();
  try { filas = txt.startsWith("[") ? JSON.parse(txt) : txt.split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  const cont = {};
  for (const s of SERVICIOS) cont[s] = { estado: "no existe" };
  for (const f of filas) if (cont[f.Service]) cont[f.Service] = { estado: f.State, salud: f.Health || "", detalle: f.Status, puertos: f.Publishers ? f.Publishers.filter((x) => x.PublishedPort).map((x) => `${x.PublishedPort}→${x.TargetPort}`).filter((v, i, a) => a.indexOf(v) === i).join(" ") : "" };
  if (statsCache.destino === destino) for (const [k, v] of Object.entries(statsCache.filas)) if (cont[k]) Object.assign(cont[k], v);
  const h = await pedir("GET", "/health/servicios", { timeoutMs: 6000 });
  let semilla = null;
  if (h.body && h.body.servicios) {
    try {
      const t = await token("ADMIN");
      const r = await pedir("GET", "/api/repuestos", { token: t, timeoutMs: 6000 });
      if (Array.isArray(r.body)) semilla = r.body.filter((x) => /^(FIL|PAS|BUJ)-/.test(x.codigo)).map((x) => ({ codigo: x.codigo, stock: x.stock }));
    } catch {}
  }
  return { destino, destinos: Object.fromEntries(Object.entries(DESTINOS).map(([k, v]) => [k, v.etiqueta])), gw: D().gw, contenedores: cont, salud: h.body && h.body.servicios ? h.body : { status: h.status }, semilla, overrides: overrides[destino] };
}

async function configActual() {
  const efectivos = {};
  for (const svc of new Set(Object.values(PERILLAS).map((p) => p.svc))) {
    const r = await run("docker", ["inspect", "-f", "{{json .Config.Env}}", `${D().proyecto}-${svc}-1`], { timeout: 10000 });
    let env = [];
    try { env = JSON.parse(r.stdout); } catch {}
    for (const e of env) { const i = e.indexOf("="); efectivos[`${svc}:${e.slice(0, i)}`] = e.slice(i + 1); }
  }
  return Object.entries(PERILLAS).map(([k, p]) => ({ var: k, svc: p.svc, ayuda: p.ayuda, opciones: p.opciones, efectivo: efectivos[`${p.svc}:${k}`] ?? "—", panel: overrides[destino][k] ?? null }));
}

// --- Bases de datos (SOLO LECTURA, vía mongosh dentro de cada contenedor) -----------
const BASES = { auth: "auth-db", vehicles: "vehicles-db", inventory: "inventory-db", workorders: "workorders-db" };
const OCULTOS = { passwordHash: 0, tokenHash: 0, anteriores: 0 }; // hashes de contraseñas y de refresh tokens
async function mongo(base, js) {
  const r = await run("docker", ["exec", `${D().proyecto}-${BASES[base]}-1`, "mongosh", "--quiet", base, "--eval", js], { timeout: 20000 });
  if (r.code) throw new Error((r.stderr || r.stdout || "mongosh falló").trim().split("\n").slice(-2).join(" "));
  return JSON.parse(r.stdout.trim().split("\n").pop());
}
const salidaJson = (expr) => `print(EJSON.stringify(${expr}, {relaxed: true}))`;

// Detalle de un contenedor: env (secretos enmascarados), imagen, puertos, redes, uptime, healthcheck.
const SECRETO = /SECRET|PASSWORD|PASS|TOKEN|KEY|PRIVATE/i;
async function detalleServicio(svc) {
  const r = await run("docker", ["inspect", `${D().proyecto}-${svc}-1`], { timeout: 10000 });
  if (r.code) return { svc, existe: false };
  const c = JSON.parse(r.stdout)[0];
  const env = (c.Config.Env || [])
    .map((e) => { const i = e.indexOf("="); return [e.slice(0, i), e.slice(i + 1)]; })
    .filter(([k]) => !/^(PATH|NODE_VERSION|YARN_VERSION|GOSU_VERSION|JSYAML_VERSION|MONGO_|HOME|GLIBC|REDIS_VERSION|REDIS_DOWNLOAD|NPM_)/.test(k))
    .map(([k, v]) => ({ k, v: SECRETO.test(k) ? (v ? "•••••• (oculto)" : "") : v, secreto: SECRETO.test(k) }))
    .sort((a, b) => a.k.localeCompare(b.k));
  const puertos = Object.entries(c.NetworkSettings.Ports || {}).map(([p, h]) => (h && h.length ? `${h[0].HostPort} → ${p}` : `${p} (interno)`));
  const salud = c.State.Health ? { estado: c.State.Health.Status, ultimo: (c.State.Health.Log || []).slice(-1).map((l) => ({ code: l.ExitCode, salida: String(l.Output || "").trim().slice(0, 200), fin: l.End }))[0] } : null;
  return {
    svc, existe: true, estado: c.State.Status, iniciado: c.State.StartedAt, finalizado: c.State.FinishedAt, reinicios: c.RestartCount,
    imagen: c.Config.Image, creado: c.Created, comando: [...(c.Config.Entrypoint || []), ...(c.Config.Cmd || [])].join(" "),
    puertos, redes: Object.keys(c.NetworkSettings.Networks || {}).map((n) => n.replace(`${D().proyecto}_`, "")), env, salud,
    oom: c.State.OOMKilled, exitCode: c.State.ExitCode,
  };
}

const rutas = {
  "GET /api/servicio": async (req, res, url) => {
    const svc = url.searchParams.get("svc");
    if (!SERVICIOS.includes(svc)) return json(res, 400, { error: "servicio inválido" });
    json(res, 200, await detalleServicio(svc));
  },
  "GET /api/db": async (req, res) => {
    const js = salidaJson("db.getCollectionNames().sort().map(c => ({ col: c, docs: db[c].countDocuments() }))");
    const out = await Promise.all(Object.keys(BASES).map(async (b) => { try { return { base: b, contenedor: BASES[b], colecciones: await mongo(b, js) }; } catch (e) { return { base: b, contenedor: BASES[b], error: e.message }; } }));
    json(res, 200, out);
  },
  "GET /api/db/docs": async (req, res, url) => {
    const base = url.searchParams.get("base"), col = url.searchParams.get("col") || "";
    const lim = n(url.searchParams.get("n"), 1, 50, 10);
    if (!BASES[base] || !/^[A-Za-z_][\w]{0,60}$/.test(col)) return json(res, 400, { error: "base o colección inválida" });
    try {
      json(res, 200, await mongo(base, salidaJson(`db.getCollection(${JSON.stringify(col)}).find({}, ${JSON.stringify(OCULTOS)}).sort({ _id: -1 }).limit(${lim}).toArray()`)));
    } catch (e) { json(res, 200, { error: e.message }); }
  },
  "GET /api/negocio": async (req, res) => {
    const [inv, wo] = await Promise.all([
      mongo("inventory", salidaJson(`({ repuestos: db.repuestos.find({}, { codigo: 1, nombre: 1, stock: 1 }).sort({ codigo: 1 }).limit(40).toArray(),
        movimientos: db.movimientos.find({}, { codigo: 1, tipo: 1, cantidad: 1, stockAnterior: 1, stockResultante: 1, ordenId: 1, fecha: 1 }).sort({ _id: -1 }).limit(12).toArray(),
        totalRepuestos: db.repuestos.countDocuments() })`)).catch((e) => ({ error: e.message })),
      mongo("workorders", salidaJson(`({ porEstado: db.ordenes.aggregate([{ $group: { _id: "$estado", n: { $sum: 1 } } }]).toArray(),
        ultimas: db.ordenes.find({}, { patente: 1, estado: 1, descripcion: 1, items: 1, reposicion: 1, createdAt: 1 }).sort({ _id: -1 }).limit(10).toArray() })`)).catch((e) => ({ error: e.message })),
    ]);
    json(res, 200, { inventory: inv, workorders: wo });
  },
  "GET /api/estado": async (req, res) => json(res, 200, await estado()),
  "POST /api/destino": async (req, res) => {
    const p = await leerCuerpo(req);
    if (!DESTINOS[p.destino]) return json(res, 400, { error: "destino inválido" });
    destino = p.destino;
    statsCache = { destino: null, filas: {}, t: 0 };
    json(res, 200, { destino });
  },
  "POST /api/docker": async (req, res) => {
    const p = await leerCuerpo(req);
    const acciones = { apagar: ["stop"], prender: ["up", "-d", "--wait", "--no-deps"], matar: ["kill"], congelar: ["pause"], descongelar: ["unpause"], reiniciar: ["restart"] };
    const todos = { "todo:prender": ["up", "-d", "--wait"], "todo:apagar": ["stop"], "todo:reiniciar": ["restart"] };
    let args;
    if (todos[p.accion]) args = todos[p.accion];
    else if (acciones[p.accion] && SERVICIOS.includes(p.servicio)) args = [...acciones[p.accion], p.servicio];
    else if (p.accion === "todo:reset" && destino === "defensa") args = null;
    else return json(res, 400, { error: "acción inválida" });
    if (exigirConfirmacion(p) && !["prender", "descongelar", "todo:prender"].includes(p.accion)) return json(res, 409, { error: "confirmar", mensaje: `Vas a ${p.accion} ${p.servicio || "todo"} en la DEMO REAL.` });
    const ini = Date.now();
    const r = await enCola(async () => {
      if (p.accion === "todo:reset") {
        const a = await compose(["down", "-v"]);
        if (a.code) return a;
        return compose(["up", "-d", "--wait"]);
      }
      return compose(args);
    });
    if (p.accion === "todo:reset") tokens[destino] = {}; demoCache[destino] = {};
    json(res, r.code ? 500 : 200, { ok: !r.code, segundos: Math.round((Date.now() - ini) / 100) / 10, salida: (r.stdout + r.stderr).trim().split("\n").slice(-6).join("\n") });
  },
  "GET /api/config": async (req, res) => json(res, 200, await configActual()),
  "POST /api/config": async (req, res) => {
    const p = await leerCuerpo(req);
    const per = PERILLAS[p.var];
    if (!per) return json(res, 400, { error: "variable desconocida" });
    if (p.valor !== null && !per.ok(String(p.valor))) return json(res, 400, { error: `valor inválido para ${p.var}` });
    if (exigirConfirmacion(p)) return json(res, 409, { error: "confirmar", mensaje: `Vas a recrear ${per.svc} en la DEMO REAL con ${p.var}=${p.valor ?? "(valor del .env)"}.` });
    if (p.valor === null) delete overrides[destino][p.var];
    else overrides[destino][p.var] = String(p.valor);
    const ini = Date.now();
    const r = await enCola(() => compose(["up", "-d", "--wait", "--no-deps", per.svc]));
    if (per.svc === "auth-service") tokens[destino] = {}; demoCache[destino] = {};
    json(res, r.code ? 500 : 200, { ok: !r.code, segundos: Math.round((Date.now() - ini) / 100) / 10, salida: (r.stdout + r.stderr).trim().split("\n").slice(-4).join("\n") });
  },
  "POST /api/config/restaurar": async (req, res) => {
    const p = await leerCuerpo(req);
    if (exigirConfirmacion(p)) return json(res, 409, { error: "confirmar", mensaje: "Vas a recrear servicios de la DEMO REAL con los valores del .env." });
    const svcs = new Set(Object.keys(overrides[destino]).map((k) => PERILLAS[k].svc));
    overrides[destino] = {};
    for (const s of svcs) await enCola(() => compose(["up", "-d", "--wait", "--no-deps", s]));
    tokens[destino] = {}; demoCache[destino] = {};
    json(res, 200, { ok: true, recreados: [...svcs] });
  },
  // Cuentas de demo para usar la app a mano (pestaña App). Son cuentas de laboratorio con
  // contraseña conocida; la del admin real del .env nunca sale del servidor.
  "GET /api/cuentas-demo": async (req, res) => {
    try { json(res, 200, await Promise.all(Object.keys(CUENTAS_DEMO).map(cuentaDemo))); }
    catch (e) { json(res, 502, { error: e.message }); }
  },
  "POST /api/token": async (req, res) => {
    const p = await leerCuerpo(req);
    if (!CUENTAS_DEMO[p.como]) return json(res, 400, { error: "rol inválido" });
    try { json(res, 200, await cuentaDemo(p.como)); }
    catch (e) { json(res, 502, { error: e.message }); }
  },
  "GET /api/catalogo": async (req, res) => json(res, 200, Object.fromEntries(Object.entries(CATALOGO).map(([k, v]) => [k, { invasivo: !!v.invasivo }]))),
  "POST /api/trabajos": async (req, res) => {
    const p = await leerCuerpo(req);
    const c = CATALOGO[p.tipo];
    if (!c) return json(res, 400, { error: "tipo desconocido" });
    const params = p.params || {};
    if (c.invasivo && exigirConfirmacion(p)) return json(res, 409, { error: "confirmar", mensaje: `«${c.titulo(params)}» modifica datos o servicios de la DEMO REAL.` });
    const [cmd, args] = c.cmd(params);
    const t = lanzar(c.titulo(params), cmd, args, c.env ? c.env(params) : {});
    json(res, 200, { id: t.id, titulo: t.titulo });
  },
  "GET /api/trabajos": async (req, res) => json(res, 200, [...trabajos.values()].reverse().map((t) => ({ id: t.id, titulo: t.titulo, destino: t.destino, inicio: t.inicio, fin: t.fin, code: t.code }))),
  "POST /api/trabajos/parar": async (req, res) => {
    const p = await leerCuerpo(req);
    const t = trabajos.get(String(p.id));
    if (!t || t.fin) return json(res, 404, { error: "no está corriendo" });
    try { process.kill(-t.proc.pid, "SIGINT"); } catch {}
    setTimeout(() => { if (!t.fin) try { process.kill(-t.proc.pid, "SIGKILL"); } catch {} }, 3000);
    json(res, 200, { ok: true });
  },
  "POST /api/pedido": async (req, res) => {
    const p = await leerCuerpo(req);
    const metodo = String(p.metodo || "GET").toUpperCase();
    const ruta = String(p.ruta || "");
    if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(metodo) || !/^\/(api|health)[\w\-./?=&%:,]*$/.test(ruta)) return json(res, 400, { error: "método o ruta inválidos (la ruta empieza con /api o /health)" });
    let body;
    if (p.body !== undefined && p.body !== "" && metodo !== "GET") body = p.body;
    let tk;
    try { if (p.como === "ADMIN" || p.como === "MECANICO") tk = await token(p.como); } catch (e) { return json(res, 200, { status: "ERROR", ms: 0, body: e.message }); }
    if (p.como === "TOKEN_VENCIDO") tk = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4IiwiZXhwIjoxfQ.firma-invalida";
    json(res, 200, await pedir(metodo, ruta, { token: tk, body, timeoutMs: 30000 }));
  },
  "GET /api/rid": async (req, res, url) => {
    const rid = url.searchParams.get("id") || "";
    if (!/^[\w-]{4,80}$/.test(rid)) return json(res, 400, { error: "rid inválido" });
    const r = await compose(["logs", "--no-color", "--since", "30m"], { timeout: 30000 });
    json(res, 200, { lineas: (r.stdout + r.stderr).split("\n").filter((l) => l.includes(rid)).slice(-200) });
  },
};

function streamTrabajo(req, res, id) {
  const t = trabajos.get(id);
  if (!t) return json(res, 404, { error: "no existe" });
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  for (const l of t.lineas) res.write(`data: ${JSON.stringify(l)}\n\n`);
  if (t.fin) { res.write(`event: fin\ndata: ${JSON.stringify(t.code)}\n\n`); return res.end(); }
  t.clientes.add(res);
  req.on("close", () => t.clientes.delete(res));
}
function streamLogs(req, res, svc) {
  if (svc !== "todos" && !SERVICIOS.includes(svc)) return json(res, 400, { error: "servicio inválido" });
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const p = spawn("docker", ["compose", "-p", D().proyecto, "logs", "-f", "--no-color", "--tail", "80", ...(svc === "todos" ? [] : [svc])], { cwd: RAIZ, env: envCompose() });
  const enviar = (d) => { for (const l of d.toString().split("\n")) if (l) res.write(`data: ${JSON.stringify(l)}\n\n`); };
  p.stdout.on("data", enviar);
  p.stderr.on("data", enviar);
  req.on("close", () => p.kill());
}

// Acceso desde otra PC de la red: PANEL_HOST=0.0.0.0. En ese modo se exige una clave
// (PANEL_TOKEN o una aleatoria): se entra una vez con ?k=<clave> y queda en una cookie.
const HOST = process.env.PANEL_HOST || "127.0.0.1";
const REMOTO = !["127.0.0.1", "localhost", "::1"].includes(HOST);
const CLAVE = process.env.PANEL_TOKEN || randomBytes(9).toString("base64url");
function autorizado(req, res, url) {
  if (!REMOTO) return true;
  const ip = req.socket.remoteAddress || "";
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  if (url.searchParams.get("k") === CLAVE) {
    res.writeHead(302, { "set-cookie": `panel=${CLAVE}; HttpOnly; SameSite=Strict; Path=/`, location: "/" });
    res.end();
    return false;
  }
  if ((req.headers.cookie || "").split(/;\s*/).includes(`panel=${CLAVE}`)) return true;
  res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
  res.end("Falta la clave del panel: abrí la URL con ?k=<clave> que muestra la terminal.");
  return false;
}

// La app (Swagger + API de Torque) servida por el panel con el mismo origen: así la pestaña
// «App» puede incrustarla y autorizarla, y también anda desde otra PC (modo red).
// Las rutas del panel (/api/estado, /api/docker…) no chocan con las de Torque.
const APP_PROXY = /^\/(api-docs(\/|$)|api\/(vehiculos|repuestos|ordenes|auth)(\/|$)|health(\/|$)|metrics(\/|$))/;
function proxyApp(req, res) {
  const destino = new URL(D().gw);
  const headers = { ...req.headers, host: destino.host };
  delete headers.cookie; // la cookie del panel no viaja a Torque
  const p = http.request({ hostname: destino.hostname, port: destino.port, method: req.method, path: req.url, headers, timeout: 60000 }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  p.on("timeout", () => p.destroy(new Error("timeout")));
  p.on("error", (e) => { if (!res.headersSent) json(res, 502, { error: `La app no responde (${e.code || e.message})` }); else res.end(); });
  req.pipe(p);
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (!autorizado(req, res, url)) return;
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(readFileSync(join(AQUI, "index.html")));
    }
    const m = url.pathname.match(/^\/api\/trabajos\/(\d+)\/stream$/);
    if (m) return streamTrabajo(req, res, m[1]);
    if (url.pathname === "/api/logs/stream") return streamLogs(req, res, url.searchParams.get("svc"));
    const h = rutas[`${req.method} ${url.pathname}`];
    if (!h && APP_PROXY.test(url.pathname)) return proxyApp(req, res);
    if (!h) return json(res, 404, { error: "no existe" });
    await h(req, res, url);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});
if (REMOTO) {
  servidor.listen(PUERTO, HOST, () => {
    const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal && !/^172\.(1[6-9]|2\d|3[01])\./.test(i.address)).map((i) => i.address);
    console.log(`Panel de Torque (accesible desde la red) · destino inicial: ${D().etiqueta}`);
    for (const ip of ips) console.log(`  http://${ip}:${PUERTO}/?k=${CLAVE}`);
    console.log(`  (en esta PC, sin clave: http://localhost:${PUERTO})`);
  });
} else {
  // IPv4 e IPv6 de loopback: algunos navegadores resuelven «localhost» como ::1.
  servidor.listen(PUERTO, "127.0.0.1", () => console.log(`Panel de Torque en http://localhost:${PUERTO} · destino inicial: ${D().etiqueta}`));
  const servidor6 = http.createServer((req, res) => servidor.emit("request", req, res));
  servidor6.on("error", () => {}); // sin IPv6: alcanza con 127.0.0.1
  servidor6.listen(PUERTO, "::1");
}
