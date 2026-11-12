// «¿Qué pasa si se cae X?» — se detiene/mata cada pieza y se mide qué sigue andando.
//   node scripts/defensa/caos.mjs [auth|inventory|redis|vehicles|wodb|killwo|killinv|timeout|reinicio|todo]
import {
  escenario, log, guardarJson, req, tokenAdmin, mecanicos, crearRepuestos, compose, reconfigurar, invariantes, SEMILLA, dormir,
} from "./lib.mjs";

const parar = (s) => compose(`stop ${s}`);
const matar = (s) => compose(`kill ${s}`);
const levantar = (s, env = {}) => compose(`up -d --wait --no-deps ${s}`, env);
const salud = async () => {
  const h = (await req("GET", "/health/servicios")).body;
  return Object.entries(h.servicios).map(([k, v]) => `${k.replace("-service", "")}=${v.status}${v.dependencias ? JSON.stringify(v.dependencias) : ""}`).join(" ");
};
const orden = (t, repuestos, extra = {}) =>
  req("POST", "/api/ordenes", { token: t, body: { vehiculoId: SEMILLA.vehiculos[0], descripcion: "caos", repuestos, ...extra }, timeoutMs: 60000 });
const cuantas = async (t) => (await req("GET", "/api/ordenes", { token: t })).body.length;
const st = (r) => `${r.status} ${r.body && r.body.error ? `«${r.body.error}»` : ""} (${Math.round(r.ms)} ms)`;
const resultados = {};

async function auth() {
  escenario("K1-cae-auth-service");
  const t = await tokenAdmin();
  parar("auth-service");
  log("auth-service detenido. Salud:", await salud());
  log("  login nuevo                    →", st(await req("POST", "/api/auth/login", { body: { email: "a@b.com", password: "x" } })));
  log("  GET /api/vehiculos (token ya emitido) →", st(await req("GET", "/api/vehiculos", { token: t })));
  log("  GET /api/repuestos             →", st(await req("GET", "/api/repuestos", { token: t })));
  log("  POST /api/ordenes sin repuestos→", st(await orden(t, [])));
  log("⇒ JWT sin estado: cada servicio valida la firma por su cuenta; sin auth no entra nadie NUEVO, pero los tokens vigentes siguen operando.");
  levantar("auth-service");
  log("auth-service levantado de nuevo. Salud:", await salud());
}

async function inventory() {
  escenario("K2-cae-inventory-service");
  const t = await tokenAdmin();
  const antes = await cuantas(t);
  parar("inventory-service");
  log("inventory-service detenido. Salud:", await salud());
  log("  GET /api/repuestos             →", st(await req("GET", "/api/repuestos", { token: t })));
  log("  POST orden CON repuestos       →", st(await orden(t, [{ repuestoId: SEMILLA.repuestos[0], cantidad: 1 }])));
  log(`  órdenes registradas: ${antes} → ${await cuantas(t)} (falla en la validación previa: no queda basura)`);
  log("  POST orden SIN repuestos       →", st(await orden(t, [])));
  log("  GET /api/vehiculos             →", st(await req("GET", "/api/vehiculos", { token: t })));
  levantar("inventory-service");
  log("Levantado. Salud:", await salud());
  log("  GET /api/repuestos             →", st(await req("GET", "/api/repuestos", { token: t })));
}

async function redis() {
  escenario("K3-cae-redis");
  const t = await tokenAdmin();
  const [rep] = await crearRepuestos("K3", 1, 10, t);
  parar("redis");
  await dormir(1000);
  log("redis detenido. Salud:", await salud());
  log("  GET /api/repuestos (lectura, va a Mongo) →", st(await req("GET", "/api/repuestos", { token: t })));
  const o = await orden(t, [{ repuestoId: rep, cantidad: 1 }]);
  log("  POST orden con repuesto         →", st(o), "estado", o.body.orden && o.body.orden.estado, "ítem", o.body.orden && o.body.orden.items[0].estado);
  log("  POST ingreso de mercadería      →", st(await req("POST", `/api/repuestos/${rep}/ingreso`, { token: t, body: { cantidad: 5 } })));
  levantar("redis");
  await dormir(2000);
  log("redis levantado. Salud:", await salud());
  log("  POST orden con repuesto         →", st(await orden(t, [{ repuestoId: rep, cantidad: 1 }])));
  const inv = await invariantes(t, { repuestos: [rep] });
  log("Invariantes:", inv.problemas.length ? inv.problemas : "OK");
  log("⇒ Sin Redis no hay exclusión mutua: el sistema PREFIERE rechazar (503) antes que escribir stock sin lock. Lecturas siguen.");
}

async function vehicles() {
  escenario("K4-cae-vehicles-service");
  const t = await tokenAdmin();
  const antes = await cuantas(t);
  parar("vehicles-service");
  log("vehicles-service detenido. Salud:", await salud());
  log("  POST orden                      →", st(await orden(t, [])));
  log(`  órdenes registradas: ${antes} → ${await cuantas(t)}`);
  log("  GET /api/ordenes (historial)    →", st(await req("GET", "/api/ordenes", { token: t })));
  log("  GET /api/repuestos              →", st(await req("GET", "/api/repuestos", { token: t })));
  levantar("vehicles-service");
  log("Levantado. Salud:", await salud());
}

async function wodb() {
  escenario("K5-cae-workorders-db");
  const t = await tokenAdmin();
  parar("workorders-db");
  await dormir(1500);
  log("workorders-db detenida. Salud:", await salud());
  log("  GET /api/ordenes                →", st(await req("GET", "/api/ordenes", { token: t, timeoutMs: 20000 })));
  log("  GET /api/vehiculos              →", st(await req("GET", "/api/vehiculos", { token: t })));
  log("  GET /api/repuestos              →", st(await req("GET", "/api/repuestos", { token: t })));
  levantar("workorders-db");
  await dormir(4000);
  log("Base levantada. Salud:", await salud());
  log("  GET /api/ordenes                →", st(await req("GET", "/api/ordenes", { token: t })));
  log("⇒ Base por servicio: la caída de una base afecta solo a su dominio (aislamiento de fallas).");
}

// H05: workorders muere a mitad de la creación → orden huérfana.
async function killwo() {
  escenario("K6-muere-workorders-a-mitad-de-orden");
  reconfigurar("inventory-service", { DEMO_DELAY_MS: "1000" });
  const t = await tokenAdmin();
  const [rep] = await crearRepuestos("K6", 1, 10, t);
  const p = orden(t, [{ repuestoId: rep, cantidad: 2 }]);
  await dormir(400);
  matar("workorders-service");
  log("workorders-service MATADO (SIGKILL) a los 400 ms, con el descuento remoto en curso.");
  log("  respuesta al cliente →", st(await p));
  levantar("workorders-service");
  await dormir(1500);
  const o = (await req("GET", "/api/ordenes?estado=PENDIENTE", { token: t })).body.find((x) => x.items[0] && x.items[0].repuestoId === rep);
  const stock = (await req("GET", `/api/repuestos/${rep}`, { token: t })).body.stock;
  const libro = o ? (await req("GET", `/api/repuestos/movimientos?ordenId=${o.id}`, { token: t })).body.map((m) => `${m.tipo} ${m.cantidad}`) : [];
  log(`Tras reiniciar: orden ${o ? o.estado : "?"}, ítem ${o && o.items[0].estado}; libro [${libro.join(", ")}]; stock 10 → ${stock}`);
  log("⇒ H05 REPRODUCIDO: orden huérfana PENDIENTE con stock descontado. Nadie la retoma solo (no hay worker de reconciliación).");
  if (o) {
    const c = await req("POST", `/api/ordenes/${o.id}/cancelar`, { token: t, body: { motivo: "Recuperación manual" } });
    log(`Recuperación manual: cancelar → ${c.status}, reposición ${c.body.reposicion && c.body.reposicion.estado}, stock → ${(await req("GET", `/api/repuestos/${rep}`, { token: t })).body.stock}`);
    log("  (la reposición consulta el libro de inventory: aunque el ítem diga PENDIENTE, si hay DESCUENTO en el libro... ver resultado)");
  }
  resultados.killwo = { estado: o && o.estado, stock };
}

// Inventory muere durante el descuento → reposición PENDIENTE y reintento.
async function killinv() {
  escenario("K7-muere-inventory-a-mitad-de-orden");
  reconfigurar("inventory-service", { DEMO_DELAY_MS: "1000" });
  const t = await tokenAdmin();
  const reps = await crearRepuestos("K7", 2, 10, t);
  const p = orden(t, reps.map((r) => ({ repuestoId: r, cantidad: 1 })));
  await dormir(1500); // el 1er ítem ya descontó; el 2º está en vuelo
  matar("inventory-service");
  const r = await p;
  const o = r.body.orden;
  log("inventory MATADO durante el 2º descuento. Respuesta →", st(r));
  log(`  orden ${o.estado}; ítems ${o.items.map((i) => i.estado).join(", ")}; reposición ${o.reposicion && o.reposicion.estado}`);
  levantar("inventory-service");
  await dormir(1000);
  const re = await req("POST", `/api/ordenes/${o.id}/reponer`, { token: t });
  log(`inventory levantado. Reintento POST /api/ordenes/:id/reponer → ${re.status}; reposición ${re.body.reposicion && re.body.reposicion.estado}; ítems ${re.body.items && re.body.items.map((i) => i.estado).join(", ")}`);
  const inv = await invariantes(t, { repuestos: reps });
  log("Invariantes:", inv.problemas.length ? inv.problemas : "OK (stock y libro cuadran)");
}

// Timeout ≠ «no pasó»: el cliente se cansa de esperar pero inventory igual escribe.
async function timeout() {
  escenario("K8-timeout-estado-incierto");
  reconfigurar("inventory-service", { DEMO_DELAY_MS: "1000" });
  reconfigurar("workorders-service", { INVENTORY_TIMEOUT_MS: "400" });
  try {
    const t = await tokenAdmin();
    const [rep] = await crearRepuestos("K8", 1, 10, t);
    log("workorders espera a inventory solo 400 ms; el descuento tarda ~1 s.");
    const r = await orden(t, [{ repuestoId: rep, cantidad: 3 }]);
    const o = r.body.orden;
    log("  respuesta →", st(r));
    log(`  orden ${o.estado}; ítem ${o.items[0].estado} (${o.items[0].detalle}); reposición ${o.reposicion && o.reposicion.estado}`);
    await dormir(1500);
    const libro = (await req("GET", `/api/repuestos/movimientos?ordenId=${o.id}`, { token: t })).body.map((m) => `${m.tipo} ${m.cantidad}`);
    const stock = (await req("GET", `/api/repuestos/${rep}`, { token: t })).body.stock;
    log(`  libro de la orden [${libro.join(", ")}]; stock 10 → ${stock}`);
    const inv = await invariantes(t, { repuestos: [rep] });
    log("Invariantes:", inv.problemas.length ? inv.problemas : "OK");
    log("⇒ El timeout NO prueba que no se escribió. El ítem queda INCIERTO; la reposición consulta el libro y bloquea/devuelve.");
  } finally {
    reconfigurar("workorders-service", {});
  }
}

async function reinicio() {
  escenario("K9-reinicio-completo");
  const t = await tokenAdmin();
  const antes = { ordenes: await cuantas(t), repuestos: (await req("GET", "/api/repuestos", { token: t })).body.length };
  log("Antes:", antes);
  const ini = Date.now();
  compose("restart");
  compose("up -d --wait");
  log(`docker compose restart + healthy en ${((Date.now() - ini) / 1000).toFixed(1)} s`);
  const t2 = await tokenAdmin();
  const desp = { ordenes: await cuantas(t2), repuestos: (await req("GET", "/api/repuestos", { token: t2 })).body.length };
  log("Después:", desp, JSON.stringify(antes) === JSON.stringify(desp) ? "⇒ datos intactos (volúmenes)" : "⇒ DIFERENCIA");
  log("  token emitido ANTES del reinicio →", st(await req("GET", "/api/vehiculos", { token: t })));
}

const que = process.argv[2] || "todo";
const pasos = { auth, inventory, redis, vehicles, wodb, killwo, killinv, timeout, reinicio };
try {
  for (const [k, f] of Object.entries(pasos)) if (que === "todo" || que === k) await f();
} finally {
  compose("up -d --wait"); // todo arriba con la config por defecto
  reconfigurar("inventory-service", {});
  guardarJson("K-caos", resultados);
}
