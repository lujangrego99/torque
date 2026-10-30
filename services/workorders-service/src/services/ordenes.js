const Orden = require("../models/orden");
const vehicles = require("../clients/vehicles");
const inventory = require("../clients/inventory");
const { ErrorDependencia } = require("../clients/http");
const logger = require("../config/logger");
const { ErrorHttp, invalido, interpretarErrorPersistencia } = require("../utils/errores");
const { parsearObjectId, esObjetoJson } = require("../utils/ids");

const MAX_ITEMS = 10;

function serializar(doc) {
  return {
    id: String(doc._id),
    vehiculoId: doc.vehiculoId,
    patente: doc.patente,
    creadaPor: doc.creadaPor || null,
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
    requiereCompensacion: doc.requiereCompensacion,
    creadaEn: doc.createdAt,
    actualizadaEn: doc.updatedAt,
  };
}

// --- Validación de entrada (propia del servicio) ---------------------------

function validarEntrada(body) {
  if (!esObjetoJson(body)) {
    throw invalido(["El body debe ser un objeto JSON."]);
  }
  const errores = [];
  const vehiculoId = parsearObjectId(body.vehiculoId);
  if (vehiculoId === null) errores.push("vehiculoId debe ser un ObjectId hexadecimal de 24 caracteres.");
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
    descripcion: body.descripcion.trim(),
    repuestos: repuestos.map((r) => ({ repuestoId: r.repuestoId, cantidad: r.cantidad === undefined ? 1 : r.cantidad })),
  };
}

// --- Traducción de fallos de dependencias ----------------------------------

// Infraestructura (sin respuesta válida o 503 remoto) → 503 controlado.
// 5xx inesperado del remoto → 502. Nunca un 500 genérico de este servicio.
function errorPorDependencia(err, contexto) {
  const status = err.causa === "error_remoto" ? 502 : 503;
  const titulo = status === 503 ? "Dependencia no disponible." : "Error en un servicio dependiente.";
  return new ErrorHttp(status, titulo, [`${err.servicio}: ${err.causa}${err.detalle ? ` (${err.detalle})` : ""}`, contexto]);
}

// --- Caso de uso: crear orden de trabajo -----------------------------------
//
// 1. vehicles-service   GET  /api/vehiculos/:id            (sin cambios de estado)
// 2. inventory-service  GET  /api/repuestos/:id  (cada uno) (sin cambios de estado)
// 3. workorders-db      insert orden PENDIENTE                (1er cambio de estado, local)
// 4. inventory-service  POST /api/repuestos/:id/descontar (cada uno, en orden)  ← cambios remotos
// 5. workorders-db      orden CONFIRMADA o FALLIDA
//
// Si el paso 4 falla en el ítem k, los ítems 1..k-1 ya descontaron stock y no se
// revierten (no hay transacción distribuida): la orden queda FALLIDA con
// requiereCompensacion=true y el detalle por ítem para compensar más adelante.

// La identidad viaja de punta a punta: el token del usuario se propaga a
// vehicles-service y inventory-service (cada uno lo valida por su cuenta) y la
// orden queda a nombre de `usuario.id` (sub del token) para la regla de propiedad.
async function crear(body, { usuario, token, requestId }) {
  const entrada = validarEntrada(body);
  const remoto = { requestId, token };

  // Paso 1: el vehículo tiene que existir (dato ajeno → interfaz pública).
  let vehiculo;
  try {
    const r = await vehicles.obtenerVehiculo(entrada.vehiculoId, remoto);
    if (r.status === 401 || r.status === 403) {
      // El token propagado fue rechazado aguas abajo (p. ej. venció en el medio).
      throw new ErrorHttp(r.status, (r.body && r.body.error) || "No autorizado.", [
        "vehicles-service rechazó la identidad propagada. No se registró la orden.",
      ]);
    }
    if (!r.encontrado) {
      throw new ErrorHttp(404, "Vehículo no encontrado.", [`No existe el vehículo ${entrada.vehiculoId} en vehicles-service.`]);
    }
    vehiculo = r.vehiculo;
  } catch (err) {
    if (err instanceof ErrorDependencia) throw errorPorDependencia(err, "No se pudo validar el vehículo. No se registró la orden.");
    throw err;
  }

  // Paso 2: los repuestos tienen que existir. Solo existencia: el stock lo
  // decide inventory-service al descontar (no se duplica esa regla acá).
  const items = [];
  for (const r of entrada.repuestos) {
    try {
      const res = await inventory.obtenerRepuesto(r.repuestoId, remoto);
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
  // rastro de la operación aunque falle a mitad de camino.
  let orden;
  try {
    orden = await Orden.create({
      vehiculoId: vehiculo.id,
      patente: vehiculo.patente,
      creadaPor: usuario.id,
      descripcion: entrada.descripcion,
      items,
    });
  } catch (err) {
    throw interpretarErrorPersistencia(err) || err;
  }
  logger.info(`Orden ${orden._id} registrada PENDIENTE (vehículo ${vehiculo.patente}, ${items.length} repuestos, sub=${usuario.id}) rid=${requestId}.`);

  // Paso 4: descuentos remotos, uno por uno.
  let falla = null;
  for (const item of orden.items) {
    if (falla) {
      item.estado = "NO_INTENTADO";
      continue;
    }
    try {
      const r = await inventory.descontar(item.repuestoId, item.cantidad, remoto);
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
      // Timeout: el pedido pudo haberse aplicado igual en inventory → INCIERTO.
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
    await guardarAvance(orden);
  }

  // Paso 5: cierre.
  if (!falla) {
    orden.estado = "CONFIRMADA";
    await guardarAvance(orden);
    logger.info(`Orden ${orden._id} CONFIRMADA rid=${requestId}.`);
    return { status: 201, orden: serializar(orden) };
  }

  const descontados = orden.items.filter((i) => i.estado === "DESCONTADO" || i.estado === "INCIERTO");
  orden.estado = "FALLIDA";
  orden.falla = { etapa: falla.etapa, servicio: falla.servicio, causa: falla.causa, detalle: falla.detalle };
  orden.requiereCompensacion = descontados.length > 0;
  await guardarAvance(orden);

  const log = `Orden ${orden._id} FALLIDA en ${falla.etapa} (${falla.servicio}: ${falla.causa}) rid=${requestId}.`;
  if (orden.requiereCompensacion) {
    logger.error(
      `${log} FALLO PARCIAL: stock ya descontado/incierto para ${descontados
        .map((i) => `${i.codigo}x${i.cantidad}[${i.estado}]`)
        .join(", ")} — requiere compensación.`
    );
  } else {
    logger.warn(log);
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
    orden: serializar(orden),
  };
}

async function guardarAvance(orden) {
  try {
    await orden.save();
  } catch (err) {
    // Peor caso del fallo parcial: el stock remoto ya cambió y no se pudo
    // registrar acá. El log es la única fuente para reconciliar.
    const aplicados = orden.items.filter((i) => i.estado === "DESCONTADO").map((i) => `${i.repuestoId}x${i.cantidad}`);
    logger.error(
      `INCONSISTENCIA: no se pudo guardar la orden ${orden._id} (${err.message}). Descuentos ya aplicados en inventory-service: ${
        aplicados.join(", ") || "ninguno"
      }.`
    );
    throw err;
  }
}

// --- Consultas --------------------------------------------------------------
//
// Regla de propiedad (TP7 §11.2): el rol no alcanza. Un MECANICO solo ve las
// órdenes que creó él (creadaPor = sub del token); ADMIN ve todas.

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
  return docs.map(serializar);
}

async function obtener(idCrudo, usuario) {
  const id = parsearObjectId(idCrudo);
  if (id === null) throw invalido(["El id debe ser un ObjectId hexadecimal de 24 caracteres."]);
  const doc = await Orden.findById(id);
  if (!doc) throw new ErrorHttp(404, "Orden no encontrada.");
  if (usuario.rol !== "ADMIN" && doc.creadaPor !== usuario.id) {
    logger.warn(`Orden ${doc._id}: acceso denegado a sub=${usuario.id} (pertenece a ${doc.creadaPor || "nadie"}).`);
    throw new ErrorHttp(403, "Permisos insuficientes.", ["La orden pertenece a otro usuario."]);
  }
  return serializar(doc);
}

module.exports = { crear, listar, obtener };
