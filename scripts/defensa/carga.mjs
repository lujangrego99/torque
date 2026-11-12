// «¿Qué pasa si hay N usuarios?» — mediciones reales contra el stack en Docker.
//   node scripts/defensa/carga.mjs [lectura|login|ordenes|hot|stock|todo]
import {
  escenario, log, guardarJson, req, tokenAdmin, mecanicos, crearRepuestos, carga, rafaga, resumen,
  stats, reconfigurar, invariantes, SEMILLA, dormir,
} from "./lib.mjs";

const NIVELES_LECTURA = (process.env.NIVELES || "1,10,50,100,250,500,1000").split(",").map(Number);
const SEG = Number(process.env.SEG || 10);

async function lectura() {
  escenario("C1-lectura-concurrente");
  log("Usuarios virtuales en bucle cerrado (piden, esperan, vuelven a pedir) durante", SEG, "s por nivel.");
  log("Mitad GET /api/repuestos y mitad GET /api/vehiculos/:id, todos autenticados (JWT validado en cada servicio).");
  const t = await tokenAdmin();
  const filas = [];
  for (const n of NIVELES_LECTURA) {
    let snap = "";
    const p = carga({
      usuarios: n,
      segundos: SEG,
      fn: (vu, i) => (vu % 2 ? req("GET", "/api/repuestos", { token: t }) : req("GET", `/api/vehiculos/${SEMILLA.vehiculos[i % 2]}`, { token: t })),
    });
    await dormir(SEG * 500);
    snap = await stats();
    const r = await p;
    filas.push({ usuarios: n, ...r });
    log(`VU=${String(n).padStart(4)}  rps=${String(r.rps).padStart(7)}  p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms max=${r.max}ms  status=${JSON.stringify(r.porStatus)}`);
    if (n === NIVELES_LECTURA[NIVELES_LECTURA.length - 1] || n === 100) log("docker stats a mitad de la corrida:\n" + snap);
    await dormir(1500);
  }
  guardarJson("C1-lectura-concurrente", filas);
}

async function loginStorm() {
  escenario("C2-login-concurrente");
  log("Login concurrente: bcryptjs (JS puro) con BCRYPT_ROUNDS=12. Cada login es CPU pura en un solo hilo de auth-service.");
  const tAdmin = await tokenAdmin();
  await mecanicos(1, tAdmin);
  const filas = [];
  for (const n of [1, 5, 10, 25, 50, 100]) {
    // Mientras dura la ráfaga, otro cliente consulta /api/auth/me (no usa bcrypt) para ver si el event loop se traba.
    let seguir = true;
    const sondas = [];
    const sonda = (async () => {
      while (seguir) {
        sondas.push(await req("GET", "/api/auth/me", { token: tAdmin }));
        await dormir(50);
      }
    })();
    const { res, segundos } = await rafaga(n, () => req("POST", "/api/auth/login", { body: { email: "carga1@torque.local", password: "clave-de-prueba-1" }, timeoutMs: 120000 }));
    seguir = false;
    await sonda;
    const r = resumen(res, segundos);
    const s = resumen(sondas, segundos);
    filas.push({ logins: n, ...r, segundos: Math.round(segundos * 10) / 10, sondaMe: s });
    log(`${String(n).padStart(3)} logins a la vez → todos en ${segundos.toFixed(1)}s  (${(n / segundos).toFixed(1)} logins/s)  p50=${r.p50}ms p95=${r.p95}ms max=${r.max}ms  status=${JSON.stringify(r.porStatus)}  | /me durante la ráfaga: p50=${s.p50}ms max=${s.max}ms`);
    await dormir(1000);
  }
  guardarJson("C2-login-concurrente", filas);
}

// Crear órdenes: cada usuario virtual usa SU propio repuesto (sin competir por lock).
async function ordenes(delay) {
  const nombre = `C3-ordenes-repuestos-distintos-delay${delay}`;
  escenario(nombre);
  log(`DEMO_DELAY_MS=${delay} (retardo artificial entre leer y escribir el stock, con el lock tomado).`);
  reconfigurar("inventory-service", { DEMO_DELAY_MS: String(delay) });
  const tAdmin = await tokenAdmin();
  const mecs = await mecanicos(10, tAdmin);
  const filas = [];
  for (const n of [1, 10, 50, 100]) {
    const reps = await crearRepuestos(`C3D${delay}N${n}`, n, 100000, tAdmin);
    const segundos = 10;
    let snap = "";
    const p = carga({
      usuarios: n,
      segundos,
      fn: (vu, i) =>
        req("POST", "/api/ordenes", {
          token: mecs[vu % mecs.length].token,
          body: { vehiculoId: SEMILLA.vehiculos[vu % 2], descripcion: `carga vu${vu} #${i}`, repuestos: [{ repuestoId: reps[vu], cantidad: 1 }] },
          timeoutMs: 60000,
        }),
    });
    await dormir(5000);
    snap = await stats();
    const r = await p;
    filas.push({ usuarios: n, ...r });
    log(`VU=${String(n).padStart(3)}  órdenes/s=${String(r.rps).padStart(6)}  p50=${r.p50}ms p95=${r.p95}ms max=${r.max}ms  status=${JSON.stringify(r.porStatus)}`);
    if (n === 100) log("docker stats:\n" + snap);
    const inv = await invariantes(tAdmin, { repuestos: reps });
    log(`  invariantes (${inv.repuestosRevisados} repuestos): ${inv.problemas.length ? inv.problemas.slice(0, 5).join(" | ") : "OK (stock = libro, sin negativos, órdenes coherentes)"}`);
  }
  guardarJson(nombre, filas);
}

// Repuesto «caliente»: todos piden el MISMO repuesto a la vez.
async function hot(delay) {
  const nombre = `C4-repuesto-caliente-delay${delay}`;
  escenario(nombre);
  reconfigurar("inventory-service", { DEMO_DELAY_MS: String(delay) });
  log(`DEMO_DELAY_MS=${delay}. N mecánicos crean una orden con el MISMO repuesto (stock 1000) en el mismo instante.`);
  log("El descuento toma el lock sin esperar: si está ocupado responde 409 «Recurso ocupado» y la orden queda FALLIDA.");
  const tAdmin = await tokenAdmin();
  const mecs = await mecanicos(10, tAdmin);
  const filas = [];
  for (const n of [2, 10, 50, 100]) {
    const [rep] = await crearRepuestos(`C4D${delay}N${n}`, 1, 1000, tAdmin);
    const { res, segundos } = await rafaga(n, (i) =>
      req("POST", "/api/ordenes", {
        token: mecs[i % mecs.length].token,
        body: { vehiculoId: SEMILLA.vehiculos[0], descripcion: `hot ${i}`, repuestos: [{ repuestoId: rep, cantidad: 1 }] },
        timeoutMs: 60000,
      })
    );
    const r = resumen(res, segundos);
    const stock = (await req("GET", `/api/repuestos/${rep}`, { token: tAdmin })).body.stock;
    const ocupado = res.filter((x) => x.status === 409 && JSON.stringify(x.body).includes("ocupado")).length;
    const inv = await invariantes(tAdmin, { repuestos: [rep] });
    filas.push({ n, ...r, stockFinal: stock, ocupado, problemas: inv.problemas });
    log(`N=${String(n).padStart(3)} → 201=${r.porStatus[201] || 0}  409 ocupado=${ocupado}  otros=${JSON.stringify(r.porStatus)}  stock 1000→${stock}  en ${segundos.toFixed(1)}s  invariantes=${inv.problemas.length ? inv.problemas.join(" | ") : "OK"}`);
  }
  guardarJson(nombre, filas);
}

// Stock escaso: 5 unidades y 30 pedidos que REINTENTAN si encuentran el lock ocupado.
async function stockEscaso(delay) {
  const nombre = `C5-stock-escaso-delay${delay}`;
  escenario(nombre);
  reconfigurar("inventory-service", { DEMO_DELAY_MS: String(delay) });
  log(`DEMO_DELAY_MS=${delay}. Repuesto con stock 5. 30 clientes crean órdenes de 1 unidad y reintentan si les toca «ocupado».`);
  log("Esperado: exactamente 5 órdenes EN_PROCESO, 25 rechazadas por stock insuficiente, stock final 0, nunca negativo.");
  const tAdmin = await tokenAdmin();
  const mecs = await mecanicos(10, tAdmin);
  const [rep] = await crearRepuestos(`C5D${delay}`, 1, 5, tAdmin);
  const finales = [];
  const inicio = performance.now();
  await Promise.all(
    Array.from({ length: 30 }, async (_, i) => {
      for (let intento = 1; intento <= 200; intento++) {
        const r = await req("POST", "/api/ordenes", {
          token: mecs[i % mecs.length].token,
          body: { vehiculoId: SEMILLA.vehiculos[1], descripcion: `escaso ${i}`, repuestos: [{ repuestoId: rep, cantidad: 1 }] },
          timeoutMs: 60000,
        });
        const ocupado = r.status === 409 && JSON.stringify(r.body).includes("ocupado");
        if (!ocupado) return finales.push({ status: r.status, intento, texto: r.status === 201 ? "OK" : JSON.stringify(r.body.orden && r.body.orden.items[0].detalle) });
        await dormir(50 + Math.random() * 200);
      }
      finales.push({ status: "SE_RINDIO" });
    })
  );
  const seg = (performance.now() - inicio) / 1000;
  const stock = (await req("GET", `/api/repuestos/${rep}`, { token: tAdmin })).body.stock;
  const ok = finales.filter((f) => f.status === 201).length;
  const insuf = finales.filter((f) => f.status === 409).length;
  const intentos = finales.reduce((s, f) => s + (f.intento || 0), 0);
  const inv = await invariantes(tAdmin, { repuestos: [rep] });
  log(`Resultado: ${ok} órdenes OK, ${insuf} rechazadas por stock, stock final ${stock}, ${intentos} pedidos HTTP en total (reintentos por lock ocupado), ${seg.toFixed(1)}s.`);
  log(`Invariantes: ${inv.problemas.length ? inv.problemas.join(" | ") : "OK"}`);
  guardarJson(nombre, { ok, insuf, stock, intentos, segundos: seg, problemas: inv.problemas });
}

// Listado sin paginar: GET /api/ordenes devuelve TODAS las órdenes.
async function listado() {
  escenario("C6-listado-sin-paginar");
  const t = await tokenAdmin();
  const r = await req("GET", "/api/ordenes", { token: t });
  log(`GET /api/ordenes → ${r.body.length} órdenes, ${(JSON.stringify(r.body).length / 1e6).toFixed(1)} MB, ${Math.round(r.ms)} ms`);
  const c = await carga({ usuarios: 10, segundos: 8, fn: () => req("GET", "/api/ordenes", { token: t }) });
  log(`10 usuarios listando a la vez → ${c.rps} req/s, p50=${c.p50} ms, max=${c.max} ms`);
  const m = await req("GET", "/api/repuestos/movimientos?limite=500", { token: t });
  log(`Comparación: GET /api/repuestos/movimientos?limite=500 (sí tiene tope) → ${Math.round(m.ms)} ms`);
  guardarJson("C6-listado-sin-paginar", { ordenes: r.body.length, ms: r.ms, carga10: c });
}

const que = process.argv[2] || "todo";
const pasos = {
  lectura,
  login: loginStorm,
  ordenes: async () => { await ordenes(1000); await ordenes(0); },
  hot: async () => { await hot(1000); await hot(0); },
  stock: async () => { await stockEscaso(1000); await stockEscaso(0); },
  listado,
};
try {
  for (const [k, f] of Object.entries(pasos)) if (que === "todo" || que === k) await f();
} finally {
  reconfigurar("inventory-service", {}); // vuelve a la configuración por defecto (.env)
}
