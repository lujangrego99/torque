// Reproducción EN VIVO (Docker real) de los hallazgos de la auditoría del 12/11/2026.
// La auditoría los había probado con dobles; acá se ejecutan contra el stack.
//   node scripts/defensa/carreras.mjs [h02|h03|h04|h07|h15|todo]
import {
  escenario, log, guardarJson, req, tokenAdmin, login, mecanicos, crearRepuestos, reconfigurar, invariantes, SEMILLA, dormir, PASS_MEC,
} from "./lib.mjs";

const stockDe = async (id, t) => (await req("GET", `/api/repuestos/${id}`, { token: t })).body.stock;
const libroOrden = async (ordenId, t) =>
  (await req("GET", `/api/repuestos/movimientos?ordenId=${ordenId}`, { token: t })).body.map((m) => `${m.tipo} ${m.cantidad}`);

// H02 — cancelar mientras el descuento está en vuelo.
async function h02() {
  escenario("R-H02-cancelar-durante-descuento");
  reconfigurar("inventory-service", { DEMO_DELAY_MS: "1000" });
  log("Con DEMO_DELAY_MS=1000 el descuento tarda ~1 s. Se crea la orden y a los 400 ms se cancela.");
  const tAdmin = await tokenAdmin();
  const [rep] = await crearRepuestos("H02", 1, 10, tAdmin);
  const [mec] = await mecanicos(1, tAdmin);
  const creacion = req("POST", "/api/ordenes", {
    token: mec.token,
    body: { vehiculoId: SEMILLA.vehiculos[0], descripcion: "H02 cancelación en vuelo", repuestos: [{ repuestoId: rep, cantidad: 3 }] },
  });
  await dormir(400);
  const pend = (await req("GET", "/api/ordenes?estado=PENDIENTE", { token: tAdmin })).body.find((o) => o.items[0] && o.items[0].repuestoId === rep);
  log(`A los 400 ms la orden está ${pend ? pend.estado : "(no encontrada)"}; ítem ${pend && pend.items[0].estado}. Se cancela:`);
  const canc = await req("POST", `/api/ordenes/${pend.id}/cancelar`, { token: mec.token, body: { motivo: "El cliente se arrepintió" } });
  log(`  cancelar → ${canc.status}; reposición=${JSON.stringify(canc.body.reposicion)}`);
  const c = await creacion;
  log(`  respuesta del POST original → ${c.status} ${c.body.error || ""}`);
  await dormir(500);
  const orden = (await req("GET", `/api/ordenes/${pend.id}`, { token: tAdmin })).body;
  const stock = await stockDe(rep, tAdmin);
  const libro = await libroOrden(pend.id, tAdmin);
  log(`Estado final: orden ${orden.estado}, ítem ${orden.items[0].estado}, reposición ${orden.reposicion && orden.reposicion.estado}`);
  log(`Libro de la orden: [${libro.join(", ")}]   stock 10 → ${stock}`);
  const reproducido = orden.estado === "CANCELADA" && stock === 7;
  log(reproducido ? "⇒ H02 REPRODUCIDO: orden CANCELADA con 3 unidades consumidas y sin reposición." : "⇒ H02 no se reprodujo en esta corrida.");
  const inv = await invariantes(tAdmin, { repuestos: [rep] });
  log("Invariantes detectan el problema:", inv.problemas);
  // ¿Lo arregla el reintento de reposición?
  const re = await req("POST", `/api/ordenes/${pend.id}/reponer`, { token: mec.token });
  log(`¿Reintento de reposición? POST /api/ordenes/:id/reponer → ${re.status} ${re.body.error || ""} ${JSON.stringify(re.body.detalles || "")}`);
  guardarJson("R-H02", { reproducido, orden: orden.estado, stock, libro });
}

// H03 — rutas directas de inventario aceptan cualquier ordenId.
async function h03() {
  escenario("R-H03-descuento-directo-sin-orden");
  const tAdmin = await tokenAdmin();
  const [rep] = await crearRepuestos("H03", 1, 10, tAdmin);
  const [mec] = await mecanicos(1, tAdmin);
  const inventado = "aaaaaaaaaaaaaaaaaaaaaaaa";
  log(`Un MECANICO llama directo a inventory (vía gateway) con un ordenId que NO existe (${inventado}):`);
  const d = await req("POST", `/api/repuestos/${rep}/descontar`, { token: mec.token, body: { cantidad: 4, ordenId: inventado } });
  log(`  POST /api/repuestos/:id/descontar → ${d.status}; stock 10 → ${await stockDe(rep, tAdmin)}`);
  log("Además: orden real FINALIZADA (repuestos ya usados en el auto) y el dueño pide reposición directa:");
  const o = await req("POST", "/api/ordenes", { token: mec.token, body: { vehiculoId: SEMILLA.vehiculos[0], descripcion: "H03 finalizada", repuestos: [{ repuestoId: rep, cantidad: 2 }] } });
  const f = await req("POST", `/api/ordenes/${o.body.id}/finalizar`, { token: mec.token });
  const antes = await stockDe(rep, tAdmin);
  const r = await req("POST", "/api/repuestos/reposiciones", { token: mec.token, body: { ordenId: o.body.id } });
  log(`  orden ${f.body.estado}; POST /api/repuestos/reposiciones → ${r.status}; stock ${antes} → ${await stockDe(rep, tAdmin)} (volvieron repuestos que se usaron)`);
  guardarJson("R-H03", { descuentoFantasma: d.status, reposicionFinalizada: r.status });
}

// H04 — el lock vence (TTL) mientras la operación sigue.
async function h04() {
  escenario("R-H04-ttl-del-lock-vencido");
  log("Se reconfigura inventory con LOCK_TTL_MS=300 y DEMO_DELAY_MS=1000 (TTL < duración de la sección crítica).");
  log("Equivale a una pausa larga (GC, CPU saturada, Mongo lento) con el TTL por defecto de 8 s.");
  reconfigurar("inventory-service", { LOCK_TTL_MS: "300", DEMO_DELAY_MS: "1000" });
  try {
    const tAdmin = await tokenAdmin();
    const [rep] = await crearRepuestos("H04", 1, 1, tAdmin);
    const mecs = await mecanicos(2, tAdmin);
    const orden = (i) =>
      req("POST", "/api/ordenes", { token: mecs[i].token, body: { vehiculoId: SEMILLA.vehiculos[0], descripcion: `H04 ${i}`, repuestos: [{ repuestoId: rep, cantidad: 1 }] } });
    const a = orden(0);
    await dormir(500); // el lock de A ya venció, A sigue dentro de la sección crítica
    const b = orden(1);
    const [ra, rb] = await Promise.all([a, b]);
    const stock = await stockDe(rep, tAdmin);
    log(`Orden A → ${ra.status}, orden B → ${rb.status}; stock inicial 1 → final ${stock}`);
    log(stock < 0 ? "⇒ H04 REPRODUCIDO: sobreventa, stock NEGATIVO." : "⇒ H04 no se reprodujo.");
    log("Control con TTL por defecto (8000 ms), misma secuencia:");
    reconfigurar("inventory-service", { DEMO_DELAY_MS: "1000" });
    const t2 = await tokenAdmin();
    const [rep2] = await crearRepuestos("H04B", 1, 1, t2);
    const o2 = (i) => req("POST", "/api/ordenes", { token: mecs[i].token, body: { vehiculoId: SEMILLA.vehiculos[0], descripcion: `H04b ${i}`, repuestos: [{ repuestoId: rep2, cantidad: 1 }] } });
    const a2 = o2(0);
    await dormir(500);
    const [x, y] = await Promise.all([a2, o2(1)]);
    log(`  A → ${x.status}, B → ${y.status} (${(y.body.orden && y.body.orden.items[0].detalle) || ""}); stock 1 → ${await stockDe(rep2, t2)}`);
    guardarJson("R-H04", { a: ra.status, b: rb.status, stock });
  } finally {
    reconfigurar("inventory-service", {});
  }
}

// H07 — logout revoca el refresh, no el access ya emitido.
async function h07() {
  escenario("R-H07-logout-y-access-vigente");
  const tAdmin = await tokenAdmin();
  await mecanicos(1, tAdmin);
  const l = await login("carga1@torque.local", PASS_MEC);
  const out = await req("POST", "/api/auth/logout", { body: { refreshToken: l.refreshToken } });
  log(`logout → ${out.status}`);
  const r1 = await req("GET", "/api/vehiculos", { token: l.accessToken });
  const r2 = await req("POST", "/api/auth/refresh", { body: { refreshToken: l.refreshToken } });
  log(`Después del logout: GET /api/vehiculos con el access viejo → ${r1.status} (sigue sirviendo hasta que venza, expiresIn=${l.expiresIn}s)`);
  log(`                    POST /api/auth/refresh con el refresh revocado → ${r2.status}`);
  guardarJson("R-H07", { accessTrasLogout: r1.status, refreshTrasLogout: r2.status });
}

// H15 — sin idempotencia en el alta: doble clic = dos órdenes.
async function h15() {
  escenario("R-H15-doble-post");
  reconfigurar("inventory-service", { DEMO_DELAY_MS: "1000" });
  const tAdmin = await tokenAdmin();
  const [rep] = await crearRepuestos("H15", 1, 10, tAdmin);
  const [mec] = await mecanicos(1, tAdmin);
  const body = { vehiculoId: SEMILLA.vehiculos[1], descripcion: "Doble clic", repuestos: [{ repuestoId: rep, cantidad: 1 }] };
  const a = await req("POST", "/api/ordenes", { token: mec.token, body });
  const b = await req("POST", "/api/ordenes", { token: mec.token, body });
  log(`Mismo cuerpo dos veces seguidas → ${a.status} (${a.body.id}) y ${b.status} (${b.body.id}); stock 10 → ${await stockDe(rep, tAdmin)}`);
  log("Los dos a la vez (doble clic real):");
  const [c, d] = await Promise.all([req("POST", "/api/ordenes", { token: mec.token, body }), req("POST", "/api/ordenes", { token: mec.token, body })]);
  log(`  → ${c.status} y ${d.status} (el lock frena el segundo descuento, pero queda una orden FALLIDA extra registrada)`);
  guardarJson("R-H15", { secuencial: [a.status, b.status], simultaneo: [c.status, d.status] });
}

const que = process.argv[2] || "todo";
const pasos = { h02, h03, h04, h07, h15 };
try {
  for (const [k, f] of Object.entries(pasos)) if (que === "todo" || que === k) await f();
} finally {
  reconfigurar("inventory-service", {});
}
