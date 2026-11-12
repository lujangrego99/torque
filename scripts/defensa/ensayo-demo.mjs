// Ensayo de la «demostración mínima» del repaso (pág. 5), paso a paso, con OK/FALLA.
// Correrlo en la MÁQUINA DE LA EXPOSICIÓN antes de entrar:
//   GW=http://localhost:3000 PROYECTO=torque node scripts/defensa/ensayo-demo.mjs
import { req, tokenAdmin, mecanicos, SEMILLA, ENV } from "./lib.mjs";

let fallas = 0;
const ok = (cond, texto, extra = "") => {
  console.log(`${cond ? "  OK   " : "  FALLA"} ${texto}${extra ? `  → ${extra}` : ""}`);
  if (!cond) fallas++;
};

console.log("Ensayo de la demo contra", process.env.GW || "http://localhost:3100");
const h = await req("GET", "/health/servicios");
ok(h.status === 200 && Object.values(h.body.servicios).every((s) => s.status === "ok"), "0. todos los servicios ok", JSON.stringify(Object.fromEntries(Object.entries(h.body.servicios || {}).map(([k, v]) => [k, v.status]))));
ok((await req("GET", "/api-docs/")).status === 200, "0. Swagger accesible en /api-docs");
ok(ENV.LAB_ENDPOINTS !== "true", "0. LAB_ENDPOINTS=false en .env");
console.log(`     (JWT_EXPIRES_IN=${ENV.JWT_EXPIRES_IN || "5m (default)"}  DEMO_DELAY_MS=${ENV.DEMO_DELAY_MS || "1000 (default compose)"})`);

const t = await tokenAdmin();
ok(!!t, "1. login ADMIN");
const [mec] = await mecanicos(1, t);
ok(!!mec.token, "1. login MECANICO");

const v = await req("GET", `/api/vehiculos/${SEMILLA.vehiculos[0]}`, { token: t });
ok(v.status === 200 && v.body.activo !== false, "2. vehículo activo", `${v.body.patente}`);
const semillas = await Promise.all(SEMILLA.repuestos.map(async (id) => (await req("GET", `/api/repuestos/${id}`, { token: t })).body));
console.log("     stock de los repuestos semilla:", semillas.map((x) => `${x.codigo}=${x.stock}`).join("  "));
const r = { body: semillas.sort((a, b) => b.stock - a.stock)[0] };
const REP = r.body.id;
ok(r.body.stock >= 2, "2. repuesto con stock suficiente (≥2) — USAR ESTE EN LA DEMO", `${r.body.codigo} stock ${r.body.stock}`);

const o1 = await req("POST", "/api/ordenes", { token: mec.token, body: { vehiculoId: SEMILLA.vehiculos[0], descripcion: "Ensayo demo: service", repuestos: [{ repuestoId: REP, cantidad: 1 }] } });
ok(o1.status === 201 && o1.body.estado === "EN_PROCESO", "3. orden 1 repuesto x1 → 201 EN_PROCESO", `${o1.status} ${o1.body.estado} (${Math.round(o1.ms)} ms)`);
const movs = await req("GET", `/api/repuestos/movimientos?ordenId=${o1.body.id}`, { token: t });
ok(movs.body.length === 1 && movs.body[0].tipo === "DESCUENTO", "4. movimiento DESCUENTO en el libro");
const hist = await req("GET", `/api/ordenes/vehiculo/${SEMILLA.vehiculos[0]}`, { token: mec.token });
ok(hist.status === 200 && hist.body.ordenes.some((x) => x.id === o1.body.id), "4. historial del vehículo la muestra");
const fin = await req("POST", `/api/ordenes/${o1.body.id}/finalizar`, { token: mec.token });
ok(fin.status === 200 && fin.body.estado === "FINALIZADA", "4. finalizar → FINALIZADA");

const o2 = await req("POST", "/api/ordenes", { token: mec.token, body: { vehiculoId: SEMILLA.vehiculos[0], descripcion: "Ensayo demo: a cancelar", repuestos: [{ repuestoId: REP, cantidad: 1 }] } });
const antes = (await req("GET", `/api/repuestos/${REP}`, { token: t })).body.stock;
const c = await req("POST", `/api/ordenes/${o2.body.id}/cancelar`, { token: mec.token, body: { motivo: "El cliente no aprobó el presupuesto" } });
const despues = (await req("GET", `/api/repuestos/${REP}`, { token: t })).body.stock;
ok(c.status === 200 && c.body.reposicion && c.body.reposicion.estado === "COMPLETA" && despues === antes + 1, "5. cancelar EN_PROCESO → reposición COMPLETA", `stock ${antes} → ${despues}`);

ok((await req("GET", "/api/ordenes")).status === 401, "6. sin token → 401");
ok((await req("POST", "/api/repuestos", { token: mec.token, body: { nombre: "x", codigo: "XXXXX", stock: 1 } })).status === 403, "6. MECANICO da de alta repuesto → 403");

console.log(fallas ? `\n${fallas} FALLA(S): no salir a exponer sin revisar.` : "\nTodo OK: la demo está lista.");
process.exit(fallas ? 1 : 0);
