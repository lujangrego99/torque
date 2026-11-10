const Orden = require("../models/orden");
const vehicles = require("../clients/vehicles");
const inventory = require("../clients/inventory");
const { ErrorDependencia } = require("../clients/http");
const logger = require("../config/logger");
const { ErrorHttp, invalido, interpretarErrorPersistencia } = require("../utils/errores");
const { parsearObjectId, esObjetoJson } = require("../utils/ids");

const MAX_ITEMS = 10;
const MOTIVO_MIN = 5;

function serializar(doc, usuario) {
  const sub = (o) => (o && (o.fecha || o.estado) ? o : undefined);
  return {
    id: String(doc._id),
    vehiculoId: doc.vehiculoId,
    patente: doc.patente,
    creadaPor: doc.creadaPor || null,
    ...(usuario ? { propia: doc.creadaPor === usuario.id } : {}),
    descripcion: doc.descripcion,
    estado: doc.estado,
    items: doc.items.map((i) => ({
      repuestoId: i.repuestoId,
      codigo: i.codigo,
      nombre: i.nombre,
      cantidad: i.cantidad,
      estado: i.estado,
      ...(i.detalle ? { detalle: i.detalle } : {}),
    })),
    ...(doc.falla && doc.falla.etapa ? { falla: doc.falla } : {}),
    ...(sub(doc.cancelacion) ? { cancelacion: doc.cancelacion } : {}),
    ...(sub(doc.finalizacion) ? { finalizacion: doc.finalizacion } : {}),
    ...(sub(doc.reposicion) ? { reposicion: doc.reposicion } : {}),
    requiereCompensacion: doc.requiereCompensacion,
    historial: (doc.historial || []).map((h) => ({ estado: h.estado, fecha: h.fecha, por: h.por, ...(h.detalle ? { detalle: h.detalle } : {}) })),
    creadaEn: doc.createdAt,
    actualizadaEn: doc.updatedAt,
  };
}

const transicion = (estado, por, detalle) => ({ estado, fecha: new Date(), por, ...(detalle ? { detalle } : {}) });

// --- Validación de entrada (propia del servicio) ---------------------------

function validarEntrada(body) {
  if (!esObjetoJson(body)) {
    throw invalido(["El body debe ser un objeto JSON."]);
  }
  const errores = [];
  // El vehículo se indica por id o por patente (si el auto ya estaba cargado,
  // alcanza con la patente: se usa el registro existente).
  const vehiculoId = body.vehiculoId === undefined ? null : parsearObjectId(body.vehiculoId);
  const patente = typeof body.patente === "string" ? body.patente.trim().toUpperCase().replace(/[\s-]/g, "") : null;
  if (body.vehiculoId !== undefined && vehiculoId === null) errores.push("vehiculoId debe ser un ObjectId hexadecimal de 24 caracteres.");
  if (body.vehiculoId === undefined && !patente) errores.push("Indicar vehiculoId o patente.");
  if (body.vehiculoId !== undefined && body.patente !== undefined) errores.push("Indicar vehiculoId o patente, no ambos.");
  if (typeof body.descripcion !== "string" || body.descripcion.trim().length < 3) {
    errores.push("descripcion es obligatoria (mínimo 3 caracteres).");
  }

  const repuestos = body.repuestos === undefined ? [] : body.repuestos;
  if (!Array.isArray(repuestos) || repuestos.length > MAX_ITEMS) {
    errores.push(`repuestos debe ser un arreglo de hasta ${MAX_ITEMS} elementos.`);
  } else {
    const vistos = new Set();
    repuestos.forEach((r, i) => {
      if (!esObjetoJson(r) || parsearObjectId(r.repuestoId) === null) {
        errores.push(`repuestos[${i}].repuestoId debe ser un ObjectId hexadecimal de 24 caracteres.`);
      } else if (vistos.has(r.repuestoId)) {
        errores.push(`repuestos[${i}].repuestoId está repetido.`);
      } else {
        vistos.add(r.repuestoId);
      }
      const cantidad = r && r.cantidad === undefined ? 1 : r && r.cantidad;
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        errores.push(`repuestos[${i}].cantidad debe ser un entero positivo.`);
      }
    });
  }

  if (errores.length) throw invalido(errores);
  return {
    vehiculoId,
    patente,
    descripcion: body.descripcion.trim(),
    repuestos: repuestos.map((r) => ({ repuestoId: r.repuestoId, cantidad: r.cantidad === undefined ? 1 : r.cantidad })),
  };
}

function motivoObligatorio(body) {
  if (!esObjetoJson(body) || typeof body.motivo !== "string" || body.motivo.trim().length < MOTIVO_MIN) {
    throw invalido([`motivo es obligatorio (mínimo ${MOTIVO_MIN} caracteres).`]);
  }
  return body.motivo.trim().slice(0, 200);
}

function idOrden(idCrudo) {
  const id = parsearObjectId(idCrudo);
  if (id === null) throw invalido(["El id debe ser un ObjectId hexadecimal de 24 caracteres."]);
  return id;
}

// --- Traducción de fallos de dependencias ----------------------------------

// Infraestructura (sin respuesta válida o 503 remoto) → 503 controlado.
// 5xx inesperado del remoto → 502. Nunca un 500 genérico de este servicio.
function errorPorDependencia(err, contexto) {
  const status = err.causa === "error_remoto" ? 502 : 503;
  const titulo = status === 503 ? "Dependencia no disponible." : "Error en un servicio dependiente.";
  return new ErrorHttp(status, titulo, [`${err.servicio}: ${err.causa}${err.detalle ? ` (${err.detalle})` : ""}`, contexto]);
}

// --- Propiedad --------------------------------------------------------------
// Regla de propiedad (TP7 §11.2): el rol no alcanza. Un MECANICO solo ve,
// edita, finaliza y cancela las órdenes que creó (creadaPor = sub del token);
// ADMIN, todas. La única excepción es el historial del vehículo (solo lectura).
function verificarPropiedad(doc, usuario, accion) {
  if (usuario.rol !== "ADMIN" && doc.creadaPor !== usuario.id) {
    logger.warn(`Orden ${doc._id}: ${accion} denegado a sub=${usuario.id} (pertenece a ${doc.creadaPor || "nadie"}).`);
    throw new ErrorHttp(403, "Permisos insuficientes.", ["La orden pertenece a otro usuario."]);
  }
}

async function buscarPropia(idCrudo, usuario, accion) {
  const doc = await Orden.findById(idOrden(idCrudo));
  if (!doc) throw new ErrorHttp(404, "Orden no encontrada.");
  verificarPropiedad(doc, usuario, accion);
  return doc;
}

// --- Persistencia del avance -------------------------------------------------
// Mientras se crea, la orden se guarda ítem por ítem. Las escrituras son
// condicionales (estado PENDIENTE): si alguien la canceló en el medio, el
// proceso de creación no pisa la cancelación.
async function guardarAvance(orden, cambios = {}) {
  try {
    const r = await Orden.updateOne(
      { _id: orden._id, estado: "PENDIENTE" },
      { $set: { items: orden.items, ...cambios.set }, ...(cambios.push ? { $push: cambios.push } : {}) }
    );
    return r.matchedCount === 1;
  } catch (err) {
    // Peor caso del fallo parcial: el stock remoto ya cambió y no se pudo
    // registrar acá. El libro de movimientos de inventory (por ordenId) permite
    // reconciliar y reponer más tarde.
    const aplicados = orden.items.filter((i) => i.estado === "DESCONTADO").map((i) => `${i.repuestoId}x${i.cantidad}`);
    logger.error(
      `INCONSISTENCIA: no se pudo guardar la orden ${orden._id} (${err.message}). Descuentos ya aplicados en inventory-service: ${
        aplicados.join(", ") || "ninguno"
      }.`
    );
    throw err;
  }
}

// --- Reposición del stock (requisito 10) -------------------------------------
// Pide a inventory que devuelva lo que su libro registra como descontado por
// esta orden (contramovimiento, idempotente). Se incluyen los ítems INCIERTOS:
// inventory consulta el libro y, si el descuento no se aplicó, lo bloquea.
// Si inventory no responde, la reposición queda PENDIENTE y se reintenta con
// POST /api/ordenes/:id/reponer (no se pierde: el libro sigue teniendo los descuentos).
async function reponerStock(doc, motivo, remoto) {
  const aReponer = doc.items.filter((i) => ["DESCONTADO", "INCIERTO"].includes(i.estado));
  const intentos = ((doc.reposicion && doc.reposicion.intentos) || 0) + 1;
  if (!aReponer.length) {
    doc.reposicion = { estado: "NO_REQUERIDA", unidades: 0, fecha: new Date(), intentos };
    doc.requiereCompensacion = false;
    return doc.reposicion;
  }
  let r;
  try {
    r = await inventory.reponer(String(doc._id), aReponer.map((i) => i.repuestoId), motivo, remoto);
  } catch (err) {
    if (!(err instanceof ErrorDependencia)) throw err;
    r = { ok: false, status: err.causa, body: { error: err.detalle || "" } };
  }
  if (!r.ok) {
    const detalle = `inventory-service: ${r.status} ${(r.body && (r.body.error || "")) || ""}`.trim();
    doc.reposicion = { estado: "PENDIENTE", fecha: new Date(), detalle, intentos };
    doc.requiereCompensacion = true;
    logger.error(`Orden ${doc._id}: reposición PENDIENTE (${detalle}). Reintentar con POST /api/ordenes/${doc._id}/reponer rid=${remoto.requestId}.`);
    return doc.reposicion;
  }
  const porId = new Map(r.body.items.map((x) => [x.repuestoId, x]));
  for (const item of doc.items) {
    const x = porId.get(item.repuestoId);
    if (!x) continue;
    if (x.repuesto > 0) {
      item.estado = "REPUESTO";
      item.detalle = `repuestas ${x.repuesto} unidades (stock ${x.stock !== undefined ? x.stock : "?"})`;
    } else if (item.estado === "INCIERTO") {
      item.estado = "NO_APLICADO";
      item.detalle = "el libro de movimientos confirma que el descuento no se aplicó";
    }
  }
  doc.reposicion = { estado: "COMPLETA", unidades: r.body.unidadesRepuestas, fecha: new Date(), intentos };
  doc.requiereCompensacion = false;
  logger.info(`Orden ${doc._id}: reposición COMPLETA (${r.body.unidadesRepuestas} unidades) rid=${remoto.requestId}.`);
  return doc.reposicion;
}

// --- Caso de uso: crear orden de trabajo -----------------------------------
//
// 1. vehicles-service   GET  /api/vehiculos/:id (o /patente/:p)    (sin cambios de estado)
// 2. inventory-service  GET  /api/repuestos/:id  (cada uno)         (sin cambios de estado)
// 3. workorders-db      insert orden PENDIENTE                       (1er cambio de estado, local)
// 4. inventory-service  POST /api/repuestos/:id/descontar {ordenId}  ← cambios remotos, ligados a la orden
// 5. workorders-db      orden EN_PROCESO, o FALLIDA + reposición automática
//
// Si el paso 4 falla en el ítem k, los ítems 1..k-1 ya descontaron stock. No
// hay transacción distribuida: se devuelven con un contramovimiento (paso 5).

// La identidad viaja de punta a punta: el token del usuario se propaga a
// vehicles-service y inventory-service (cada uno lo valida por su cuenta) y la
// orden queda a nombre de `usuario.id` (sub del token) para la regla de propiedad.
async function crear(body, { usuario, token, requestId }) {
  const entrada = validarEntrada(body);
  const remoto = { requestId, token };

  // Paso 1: el vehículo tiene que existir y estar activo (dato ajeno → interfaz pública).
  let vehiculo;
  try {
    const r = entrada.vehiculoId
      ? await vehicles.obtenerVehiculo(entrada.vehiculoId, remoto)
      : await vehicles.obtenerPorPatente(entrada.patente, remoto);
    if (r.status === 401 || r.status === 403) {
      // El token propagado fue rechazado aguas abajo (p. ej. venció en el medio).
      throw new ErrorHttp(r.status, (r.body && r.body.error) || "No autorizado.", [
        "vehicles-service rechazó la identidad propagada. No se registró la orden.",
      ]);
    }
    if (!r.encontrado) {
      throw new ErrorHttp(404, "Vehículo no encontrado.", [
        `No existe el vehículo ${entrada.vehiculoId || `con patente ${entrada.patente}`} en vehicles-service.`,
      ]);
    }
    vehiculo = r.vehiculo;
  } catch (err) {
    if (err instanceof ErrorDependencia) throw errorPorDependencia(err, "No se pudo validar el vehículo. No se registró la orden.");
    throw err;
  }
  if (vehiculo.activo === false) {
    throw new ErrorHttp(409, "Vehículo dado de baja.", [`El vehículo ${vehiculo.patente} está inactivo: no admite órdenes nuevas.`]);
  }

  // Paso 2: los repuestos tienen que existir. Solo existencia: el stock lo
  // decide inventory-service al descontar (no se duplica esa regla acá).
  const items = [];
  for (const r of entrada.repuestos) {
    try {
      const res = await inventory.obtenerRepuesto(r.repuestoId, remoto);
      if (res.status === 401 || res.status === 403) {
        throw new ErrorHttp(res.status, (res.body && res.body.error) || "No autorizado.", [
          "inventory-service rechazó la identidad propagada. No se registró la orden.",
        ]);
      }
      if (!res.encontrado) {
        throw new ErrorHttp(404, "Repuesto no encontrado.", [`No existe el repuesto ${r.repuestoId} en inventory-service.`]);
      }
      items.push({ ...r, codigo: res.repuesto.codigo, nombre: res.repuesto.nombre, estado: "PENDIENTE" });
    } catch (err) {
      if (err instanceof ErrorDependencia) throw errorPorDependencia(err, "No se pudieron validar los repuestos. No se registró la orden.");
      throw err;
    }
  }

  // Paso 3: se registra la orden ANTES de tocar stock ajeno, para que quede
  // rastro de la operación aunque falle a mitad de camino. Su id viaja en cada
  // descuento y queda en el libro de movimientos de inventory.
  let orden;
  try {
    orden = await Orden.create({
      vehiculoId: vehiculo.id,
      patente: vehiculo.patente,
      creadaPor: usuario.id,
      descripcion: entrada.descripcion,
      items,
      historial: [transicion("PENDIENTE", usuario.id, "Orden registrada")],
    });
  } catch (err) {
    throw interpretarErrorPersistencia(err) || err;
  }
  const ordenId = String(orden._id);
  logger.info(`Orden ${ordenId} registrada PENDIENTE (vehículo ${vehiculo.patente}, ${items.length} repuestos, sub=${usuario.id}) rid=${requestId}.`);

  // Paso 4: descuentos remotos, uno por uno, ligados a la orden.
  let falla = null;
  for (const item of orden.items) {
    if (falla) {
      item.estado = "NO_INTENTADO";
      continue;
    }
    try {
      const r = await inventory.descontar(item.repuestoId, item.cantidad, ordenId, remoto);
      if (r.ok) {
        item.estado = "DESCONTADO";
        item.detalle = `stock restante ${r.body.item.stock}`;
      } else {
        // Error funcional informado por inventory (404 / 409 / 400): se propaga con su status.
        item.estado = "RECHAZADO";
        item.detalle = [r.body && r.body.error, ...((r.body && r.body.detalles) || [])].filter(Boolean).join(" ");
        falla = { status: r.status, etapa: "descuento", servicio: "inventory-service", causa: `http_${r.status}`, detalle: item.detalle };
      }
    } catch (err) {
      if (!(err instanceof ErrorDependencia)) throw err;
      // Timeout: el pedido pudo haberse aplicado igual en inventory → INCIERTO
      // (lo resuelve la reposición consultando el libro de movimientos).
      // Conexión rechazada / DNS / 503: seguro no se aplicó → RECHAZADO.
      item.estado = err.causa === "timeout" ? "INCIERTO" : "RECHAZADO";
      item.detalle = `${err.causa}${err.detalle ? `: ${err.detalle}` : ""}`;
      falla = {
        status: err.causa === "error_remoto" ? 502 : 503,
        etapa: "descuento",
        servicio: err.servicio,
        causa: err.causa,
        detalle: err.detalle,
      };
    }
    // Se persiste el avance ítem por ítem: si este servicio se cae después,
    // la orden muestra exactamente qué stock ya se descontó.
    if (!(await guardarAvance(orden))) break; // la cancelaron en el medio
  }

  // Paso 5a: todo descontado → EN_PROCESO (repuestos asignados, trabajo sin terminar).
  if (!falla) {
    const ok = await guardarAvance(orden, {
      set: { estado: "EN_PROCESO" },
      push: { historial: transicion("EN_PROCESO", usuario.id, "Repuestos asignados") },
    });
    const actual = await Orden.findById(orden._id);
    if (!ok) {
      return { status: 409, error: "La orden se canceló mientras se registraba.", orden: serializar(actual) };
    }
    logger.info(`Orden ${ordenId} EN_PROCESO rid=${requestId}.`);
    return { status: 201, orden: serializar(actual) };
  }

  // Paso 5b: falla → FALLIDA y reposición AUTOMÁTICA de lo descontado.
  const afectados = orden.items.filter((i) => i.estado === "DESCONTADO" || i.estado === "INCIERTO");
  orden.estado = "FALLIDA";
  orden.falla = { etapa: falla.etapa, servicio: falla.servicio, causa: falla.causa, detalle: falla.detalle };
  orden.requiereCompensacion = afectados.length > 0;
  const ok = await guardarAvance(orden, {
    set: { estado: "FALLIDA", falla: orden.falla, requiereCompensacion: orden.requiereCompensacion },
    push: { historial: transicion("FALLIDA", usuario.id, `${falla.servicio}: ${falla.causa}`) },
  });
  const log = `Orden ${ordenId} FALLIDA en ${falla.etapa} (${falla.servicio}: ${falla.causa}) rid=${requestId}.`;
  if (afectados.length) {
    logger.error(
      `${log} FALLO PARCIAL: stock ya descontado/incierto para ${afectados
        .map((i) => `${i.codigo}x${i.cantidad}[${i.estado}]`)
        .join(", ")} — se repone automáticamente.`
    );
  } else {
    logger.warn(log);
  }

  let actual = await Orden.findById(orden._id);
  if (ok) {
    await reponerStock(actual, `Orden fallida: ${falla.causa}`, remoto);
    await actual.save();
  }

  const mensajes = {
    409: "No se pudo completar la orden: conflicto de stock.",
    404: "No se pudo completar la orden: repuesto inexistente.",
    401: "No se pudo completar la orden: inventory-service rechazó el token propagado.",
    403: "No se pudo completar la orden: permisos insuficientes en inventory-service.",
    502: "No se pudo completar la orden: error en un servicio dependiente.",
    503: "No se pudo completar la orden: dependencia no disponible.",
  };
  return {
    status: falla.status,
    error: mensajes[falla.status] || "No se pudo completar la orden.",
    orden: serializar(actual),
  };
}

// --- Cancelar (requisito 14) --------------------------------------------------
// Dueño de la orden o ADMIN, mientras la orden esté abierta (PENDIENTE o
// EN_PROCESO). Guarda motivo, quién y cuándo; la orden queda en la base como
// CANCELADA y el stock descontado vuelve al inventario automáticamente.
async function cancelar(idCrudo, body, { usuario, token, requestId }) {
  const doc = await buscarPropia(idCrudo, usuario, "cancelar");
  const motivo = motivoObligatorio(body);
  if (!Orden.ESTADOS_ABIERTOS.includes(doc.estado)) {
    throw new ErrorHttp(409, "La orden no se puede cancelar.", [`Estado actual: ${doc.estado}. Solo se cancelan órdenes PENDIENTE o EN_PROCESO.`]);
  }
  const cancelacion = { motivo, por: usuario.id, rol: usuario.rol, fecha: new Date() };
  // Transición atómica: si dos cancelaciones (o una finalización) llegan juntas, gana una.
  const actual = await Orden.findOneAndUpdate(
    { _id: doc._id, estado: { $in: Orden.ESTADOS_ABIERTOS } },
    { $set: { estado: "CANCELADA", cancelacion }, $push: { historial: transicion("CANCELADA", usuario.id, motivo) } },
    { new: true }
  );
  if (!actual) throw new ErrorHttp(409, "La orden no se puede cancelar.", ["Cambió de estado mientras se procesaba el pedido."]);
  logger.info(`Orden ${actual._id} CANCELADA por sub=${usuario.id} (${usuario.rol}) motivo="${motivo}" rid=${requestId}.`);

  await reponerStock(actual, `Orden cancelada: ${motivo}`, { requestId, token });
  await actual.save();
  return serializar(actual, usuario);
}

// --- Finalizar ----------------------------------------------------------------
// EN_PROCESO → FINALIZADA (trabajo terminado). Dueño o ADMIN. Una orden
// finalizada ya no se cancela: los repuestos se usaron en el auto.
async function finalizar(idCrudo, { usuario, requestId }) {
  const doc = await buscarPropia(idCrudo, usuario, "finalizar");
  const actual = await Orden.findOneAndUpdate(
    { _id: doc._id, estado: "EN_PROCESO" },
    {
      $set: { estado: "FINALIZADA", finalizacion: { por: usuario.id, fecha: new Date() } },
      $push: { historial: transicion("FINALIZADA", usuario.id, "Trabajo terminado") },
    },
    { new: true }
  );
  if (!actual) {
    throw new ErrorHttp(409, "La orden no se puede finalizar.", [`Estado actual: ${doc.estado}. Solo se finalizan órdenes EN_PROCESO.`]);
  }
  logger.info(`Orden ${actual._id} FINALIZADA por sub=${usuario.id} rid=${requestId}.`);
  return serializar(actual, usuario);
}

// --- Editar (descripción) -----------------------------------------------------
async function editar(idCrudo, body, { usuario }) {
  const doc = await buscarPropia(idCrudo, usuario, "editar");
  if (!esObjetoJson(body) || typeof body.descripcion !== "string" || body.descripcion.trim().length < 3 || body.descripcion.trim().length > 200) {
    throw invalido(["descripcion es obligatoria (3 a 200 caracteres)."]);
  }
  const actual = await Orden.findOneAndUpdate(
    { _id: doc._id, estado: { $in: Orden.ESTADOS_ABIERTOS } },
    { $set: { descripcion: body.descripcion.trim() } },
    { new: true }
  );
  if (!actual) throw new ErrorHttp(409, "La orden no se puede editar.", [`Estado actual: ${doc.estado}. Solo se editan órdenes abiertas.`]);
  return serializar(actual, usuario);
}

// --- Reintentar reposición ----------------------------------------------------
// Para órdenes FALLIDA/CANCELADA cuya reposición quedó PENDIENTE (inventory no
// respondía). Es idempotente: lo ya repuesto no se vuelve a sumar.
async function reintentarReposicion(idCrudo, { usuario, token, requestId }) {
  const doc = await buscarPropia(idCrudo, usuario, "reponer");
  if (!["FALLIDA", "CANCELADA"].includes(doc.estado) || !doc.reposicion || doc.reposicion.estado !== "PENDIENTE") {
    throw new ErrorHttp(409, "No hay reposición pendiente.", [
      `Estado: ${doc.estado}, reposición: ${(doc.reposicion && doc.reposicion.estado) || "—"}.`,
    ]);
  }
  await reponerStock(doc, `Reintento de reposición (${doc.estado})`, { requestId, token });
  await doc.save();
  return serializar(doc, usuario);
}

// --- Consultas --------------------------------------------------------------

async function listar(filtros, usuario) {
  const query = usuario.rol === "ADMIN" ? {} : { creadaPor: usuario.id };
  if (filtros.estado) {
    if (!Orden.ESTADOS_ORDEN.includes(filtros.estado)) {
      throw invalido([`estado debe ser uno de: ${Orden.ESTADOS_ORDEN.join(", ")}.`]);
    }
    query.estado = filtros.estado;
  }
  if (filtros.vehiculoId) query.vehiculoId = String(filtros.vehiculoId);
  const docs = await Orden.find(query).sort({ createdAt: -1 });
  return docs.map((d) => serializar(d));
}

async function obtener(idCrudo, usuario) {
  return serializar(await buscarPropia(idCrudo, usuario, "consulta"));
}

// Historial del vehículo (requisito 4): CUALQUIER usuario autenticado ve todas
// las órdenes del auto, en solo lectura, para diagnosticar con lo que se le
// hizo antes. `propia` indica cuáles puede editar/cancelar quien consulta.
async function historialVehiculo(vehiculoCrudo, usuario) {
  const vehiculoId = parsearObjectId(vehiculoCrudo);
  if (vehiculoId === null) throw invalido(["El vehiculoId debe ser un ObjectId hexadecimal de 24 caracteres."]);
  const docs = await Orden.find({ vehiculoId }).sort({ createdAt: -1 });
  return {
    vehiculoId,
    patente: docs.length ? docs[0].patente : null,
    soloLectura: true,
    ordenes: docs.map((d) => serializar(d, usuario)),
  };
}

module.exports = { crear, cancelar, finalizar, editar, reintentarReposicion, listar, obtener, historialVehiculo };
