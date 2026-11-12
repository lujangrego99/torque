// Experimentos parametrizables para el panel. Emite líneas legibles y, para el
// gráfico, líneas «@@{json}» (una por segundo) y «@@FIN{json}» al terminar.
//   EXP=lectura VU=100 SEG=20 node scripts/panel/experimento.mjs
// Tipos: lectura · login · ordenes · mismo · invariantes · estado
import {
  req, tokenAdmin, ADMIN, mecanicos, crearRepuestos, invariantes, percentil, SEMILLA, GW, PROYECTO,
} from "../defensa/lib.mjs";

const P = process.env;
const num = (k, def, max) => Math.max(1, Math.min(max, Number(P[k]) || def));
const emitir = (o) => console.log("@@" + JSON.stringify(o));
const fin = (o) => console.log("@@FIN" + JSON.stringify(o));
const hora = () => new Date().toTimeString().slice(0, 8);

// Usuarios virtuales en bucle cerrado con un tick por segundo.
async function bucle({ usuarios, segundos, fn }) {
  const todos = [];
  let ventana = [];
  const t0 = Date.now();
  const finT = t0 + segundos * 1000;
  const tick = setInterval(() => {
    const ms = ventana.map((r) => r.ms).sort((a, b) => a - b);
    const status = {};
    for (const r of ventana) status[r.status] = (status[r.status] || 0) + 1;
    const err = ventana.filter((r) => !(typeof r.status === "number" && r.status < 400)).length;
    emitir({ t: Math.round((Date.now() - t0) / 1000), rps: ventana.length, p50: percentil(ms, 50), p95: percentil(ms, 95), err, status });
    ventana = [];
  }, 1000);
  await Promise.all(
    Array.from({ length: usuarios }, async (_, vu) => {
      let i = 0;
      while (Date.now() < finT) {
        const r = await fn(vu, i++);
        todos.push(r);
        ventana.push(r);
      }
    })
  );
  clearInterval(tick);
  const seg = (Date.now() - t0) / 1000;
  const ms = todos.map((r) => r.ms).sort((a, b) => a - b);
  const porStatus = {};
  for (const r of todos) porStatus[r.status] = (porStatus[r.status] || 0) + 1;
  return { pedidos: todos.length, rps: Math.round((todos.length / seg) * 10) / 10, p50: percentil(ms, 50), p95: percentil(ms, 95), p99: percentil(ms, 99), max: Math.round(ms[ms.length - 1] || 0), porStatus };
}

const linea = (r) => `pedidos=${r.pedidos}  rps=${r.rps}  p50=${r.p50}ms  p95=${r.p95}ms  p99=${r.p99}ms  max=${r.max}ms  status=${JSON.stringify(r.porStatus)}`;

const tipos = {
  async lectura() {
    const vu = num("VU", 50, 2000), seg = num("SEG", 15, 300);
    console.log(`[${hora()}] Lecturas: ${vu} usuarios durante ${seg} s (mitad GET /api/repuestos, mitad GET /api/vehiculos/:id)`);
    const t = await tokenAdmin();
    const r = await bucle({ usuarios: vu, segundos: seg, fn: (u, i) => (u % 2 ? req("GET", "/api/repuestos", { token: t }) : req("GET", `/api/vehiculos/${SEMILLA.vehiculos[i % 2]}`, { token: t })) });
    console.log(linea(r));
    fin(r);
  },

  async login() {
    const n = num("N", 20, 300);
    console.log(`[${hora()}] ${n} logins simultáneos (bcrypt costo 12, timeout del gateway 15 s)`);
    const t0 = performance.now();
    // Logins reales con el admin (la contraseña sale del .env y nunca se imprime).
    const r = await Promise.all(Array.from({ length: n }, () => req("POST", "/api/auth/login", { body: { email: ADMIN.email, password: ADMIN.password }, timeoutMs: 60000 })));
    const seg = (performance.now() - t0) / 1000;
    const ms = r.map((x) => x.ms).sort((a, b) => a - b);
    const porStatus = {};
    for (const x of r) porStatus[x.status] = (porStatus[x.status] || 0) + 1;
    const ok = porStatus[200] || 0;
    console.log(`total ${seg.toFixed(1)} s  ·  ${ok} OK  ·  status=${JSON.stringify(porStatus)}  ·  p50=${percentil(ms, 50)}ms  max=${Math.round(ms[ms.length - 1])}ms  ·  ≈${(ok / seg).toFixed(1)} logins/s`);
    fin({ n, segundos: Math.round(seg * 10) / 10, porStatus, p50: percentil(ms, 50), max: Math.round(ms[ms.length - 1]) });
  },

  async ordenes() {
    const vu = num("VU", 20, 500), seg = num("SEG", 15, 300);
    console.log(`[${hora()}] Órdenes: ${vu} usuarios durante ${seg} s, cada uno con su repuesto (sin competir por el lock)`);
    const t = await tokenAdmin();
    const [mec] = await mecanicos(1, t);
    const reps = await crearRepuestos("panel", vu, 1000000, t);
    console.log(`creados ${vu} repuestos de prueba con stock 1.000.000`);
    const r = await bucle({ usuarios: vu, segundos: seg, fn: (u) => req("POST", "/api/ordenes", { token: mec.token, body: { vehiculoId: SEMILLA.vehiculos[u % 2], descripcion: "Panel: carga de órdenes", repuestos: [{ repuestoId: reps[u], cantidad: 1 }] } }) });
    console.log(linea(r));
    const inv = await invariantes(t, { repuestos: reps });
    console.log(`invariantes: ${inv.problemas.length ? "PROBLEMAS\n  " + inv.problemas.join("\n  ") : "OK"} (${inv.repuestosRevisados} repuestos)`);
    fin({ ...r, invariantes: inv.problemas.length ? inv.problemas : "OK" });
  },

  async mismo() {
    const n = num("N", 20, 500), stock = Number(P.STOCK ?? 5);
    console.log(`[${hora()}] ${n} órdenes SIMULTÁNEAS sobre el MISMO repuesto (stock inicial ${stock}, 1 unidad cada una)`);
    const t = await tokenAdmin();
    const [mec] = await mecanicos(1, t);
    const [rep] = await crearRepuestos("mismo", 1, Math.max(0, stock), t);
    const res = await Promise.all(Array.from({ length: n }, () => req("POST", "/api/ordenes", { token: mec.token, body: { vehiculoId: SEMILLA.vehiculos[0], descripcion: "Panel: mismo repuesto", repuestos: [{ repuestoId: rep, cantidad: 1 }] } })));
    const cuenta = {};
    for (const r of res) {
      const k = r.status === 201 ? "201 creada" : r.status === 409 ? `409 ${(r.body && (r.body.error || "")).slice(0, 40)}` : String(r.status);
      cuenta[k] = (cuenta[k] || 0) + 1;
    }
    const final = (await req("GET", `/api/repuestos/${rep}`, { token: t })).body.stock;
    for (const [k, v] of Object.entries(cuenta)) console.log(`  ${String(v).padStart(4)} × ${k}`);
    console.log(`stock: ${stock} → ${final}   ${final < 0 ? "⚠ NEGATIVO" : "(nunca negativo)"}`);
    const inv = await invariantes(t, { repuestos: [rep] });
    console.log(`invariantes: ${inv.problemas.length ? "PROBLEMAS\n  " + inv.problemas.join("\n  ") : "OK (stock = suma del libro)"}`);
    fin({ n, stockInicial: stock, stockFinal: final, resultado: cuenta, invariantes: inv.problemas.length ? inv.problemas : "OK" });
  },

  async invariantes() {
    console.log(`[${hora()}] Invariantes sobre TODOS los repuestos y órdenes de ${PROYECTO}`);
    const t = await tokenAdmin();
    const inv = await invariantes(t);
    console.log(`repuestos revisados: ${inv.repuestosRevisados} · órdenes: ${inv.ordenesRevisadas} · estados: ${JSON.stringify(inv.estados)}`);
    console.log(inv.problemas.length ? `${inv.problemas.length} PROBLEMA(S):\n  ` + inv.problemas.slice(0, 40).join("\n  ") : "OK: stock = libro, nada negativo, órdenes coherentes");
    fin({ ...inv, problemas: inv.problemas.length });
  },
};

const tipo = P.EXP || process.argv[2];
if (!tipos[tipo]) {
  console.error(`tipo desconocido: ${tipo}. Opciones: ${Object.keys(tipos).join(", ")}`);
  process.exit(2);
}
console.log(`gateway ${GW} · proyecto ${PROYECTO}`);
tipos[tipo]().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
