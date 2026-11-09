const Repuesto = require("../models/repuesto");
const Movimiento = require("../models/movimiento");
const lock = require("../config/lock");
const config = require("../config");
const logger = require("../config/logger");
const { reiniciarRepuestos } = require("../models/seed");
const { ErrorHttp, invalido, interpretarErrorPersistencia } = require("../utils/errores");
const { parsearObjectId, esObjetoJson } = require("../utils/ids");

// Único dueño de `repuestos` y `movimientos`. Reglas:
//  - todo cambio de stock pasa por el lock de Redis del repuesto (exclusión mutua)
//    y deja una línea en el libro de movimientos (requisito 9);
//  - el stock nunca queda negativo salvo en la demo de laboratorio sin lock;
//  - lo que descuenta una orden se devuelve con un contramovimiento ligado a la
//    misma orden (REPOSICION), no con un rollback (requisito 10).

const MOTIVO_MIN = 5;

function serializar(doc) {
  return { id: String(doc._id), nombre: doc.nombre, codigo: doc.codigo, stock: doc.stock };
}

function serializarMovimiento(m) {
  return {
    id: String(m._id),
    fecha: m.fecha,
    tipo: m.tipo,
    repuestoId: m.repuestoId,
    codigo: m.codigo,
    cantidad: m.cantidad,
    stockAnterior: m.stockAnterior,
    stockResultante: m.stockResultante,
    usuario: m.usuario,
    ...(m.rol ? { rol: m.rol } : {}),
    ordenId: m.ordenId || null,
    ...(m.motivo ? { motivo: m.motivo } : {}),
  };
}

function idValido(valor, campo = "id") {
  const id = parsearObjectId(valor);
  if (id === null) {
    throw invalido([`El ${campo} debe ser un ObjectId hexadecimal de 24 caracteres.`]);
  }
  return id;
}

function cuerpo(body) {
  if (!esObjetoJson(body)) throw invalido(["El body debe ser un objeto JSON."]);
  return body;
}

function cantidadPositiva(valor, porDefecto) {
  const cantidad = valor === undefined ? porDefecto : valor;
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw invalido(["El campo cantidad debe ser un entero positivo."]);
  }
  return cantidad;
}

function textoOpcional(valor, campo, max = 200) {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor !== "string" || valor.trim().length > max) {
    throw invalido([`${campo} debe ser un texto de hasta ${max} caracteres.`]);
  }
  return valor.trim() || undefined;
}

function redisCaido() {
  return new ErrorHttp(503, "No se pudo coordinar el acceso al recurso.", ["Redis/Memurai no está disponible."]);
}

function ocupado(id) {
  return new ErrorHttp(409, "Recurso ocupado.", [`Otra operación está modificando el stock del repuesto ${id}. Reintentar.`]);
}

function esperar(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function buscar(id) {
  const doc = await Repuesto.findById(id);
  if (!doc) throw new ErrorHttp(404, "Repuesto no encontrado.");
  return doc;
}

// --- Exclusión mutua --------------------------------------------------------
// Toma el lock del repuesto, ejecuta `fn` y lo libera. `esperaMs` > 0 reintenta
// mientras el lock esté tomado (ingreso, ajuste y reposición esperan su turno);
// con 0 responde 409 enseguida (descuento: comportamiento del TP2).
async function conLock(id, fn, { esperaMs = 0 } = {}) {
  let adquirido = null;
  try {
    const limite = Date.now() + esperaMs;
    adquirido = await lock.adquirir("repuesto", id);
    while (!adquirido && Date.now() < limite) {
      await esperar(150);
      adquirido = await lock.adquirir("repuesto", id);
    }
    if (!adquirido) throw ocupado(id);
    return await fn(adquirido);
  } catch (err) {
    if (err.codigo === "redis_down") throw redisCaido();
    throw err;
  } finally {
    if (adquirido) {
      try {
        await lock.liberar(adquirido);
      } catch (err) {
        logger.error(`No se pudo liberar el lock ${adquirido.key}: ${err.message}`);
      }
    }
  }
}

// --- Aplicar un movimiento --------------------------------------------------
// Se aplica la variación con $inc y se registra la línea del libro con el saldo
// real que quedó. Si no se puede registrar la línea, se revierte el $inc: no
// queda stock modificado sin su movimiento. (Mongo standalone, sin transacciones
// multi-documento: el lock de Redis es quien garantiza que nadie más toque el
// repuesto en el medio.)
async function aplicar(repuesto, mov, ctx) {
  const actualizado = await Repuesto.findByIdAndUpdate(repuesto._id, { $inc: { stock: mov.cantidad } }, { new: true });
  try {
    const linea = await Movimiento.create({
      repuestoId: String(repuesto._id),
      codigo: repuesto.codigo,
      tipo: mov.tipo,
      cantidad: mov.cantidad,
      stockAnterior: actualizado.stock - mov.cantidad,
      stockResultante: actualizado.stock,
      usuario: ctx.usuario.id,
      rol: ctx.usuario.rol,
      ordenId: mov.ordenId,
      motivo: mov.motivo,
      requestId: ctx.requestId,
    });
    logger.info(
      `Movimiento ${mov.tipo} ${repuesto.codigo} ${mov.cantidad >= 0 ? "+" : ""}${mov.cantidad} → stock ${actualizado.stock}` +
        `${mov.ordenId ? ` orden=${mov.ordenId}` : ""} sub=${ctx.usuario.id} rid=${ctx.requestId || "-"}.`
    );
    return { item: serializar(actualizado), movimiento: serializarMovimiento(linea) };
  } catch (err) {
    await Repuesto.updateOne({ _id: repuesto._id }, { $inc: { stock: -mov.cantidad } }).catch((e) =>
      logger.error(`INCONSISTENCIA: no se pudo revertir ${mov.tipo} de ${repuesto.codigo} (${e.message}).`)
    );
    throw err;
  }
}

// --- Consultas (autenticado) -----------------------------------------------

async function listar() {
  const docs = await Repuesto.find().sort({ codigo: 1 });
  return docs.map(serializar);
}

async function obtener(idCrudo) {
  return serializar(await buscar(idValido(idCrudo)));
}

// Libro de movimientos. ADMIN ve todo; un MECANICO ve los movimientos que
// generó él (los descuentos y reposiciones de sus órdenes).
async function movimientos(filtros, ctx) {
  const query = {};
  if (filtros.repuestoId !== undefined) query.repuestoId = idValido(filtros.repuestoId, "repuestoId");
  if (filtros.ordenId !== undefined) query.ordenId = idValido(filtros.ordenId, "ordenId");
  if (filtros.tipo !== undefined) {
    if (!Movimiento.TIPOS.includes(filtros.tipo)) throw invalido([`tipo debe ser uno de: ${Movimiento.TIPOS.join(", ")}.`]);
    query.tipo = filtros.tipo;
  }
  if (ctx.usuario.rol !== "ADMIN") query.usuario = ctx.usuario.id;
  const limite = Math.min(Math.max(Number.parseInt(filtros.limite, 10) || 100, 1), 500);
  const docs = await Movimiento.find(query).sort({ fecha: -1, _id: -1 }).limit(limite);
  return docs.map(serializarMovimiento);
}

// --- Alta de repuesto (ADMIN, requisito 6) ---------------------------------

async function crear(body, ctx) {
  cuerpo(body);
  const stockInicial = body.stock === undefined ? 0 : body.stock;
  if (!Number.isInteger(stockInicial) || stockInicial < 0) {
    throw invalido(["El campo stock (inicial) debe ser un entero mayor o igual a 0."]);
  }
  let doc;
  try {
    doc = await Repuesto.create({ nombre: body.nombre, codigo: body.codigo, stock: 0 });
  } catch (err) {
    throw interpretarErrorPersistencia(err) || err;
  }
  logger.info(`Repuesto creado ${doc.codigo} id=${doc._id} sub=${ctx.usuario.id}.`);
  if (stockInicial === 0) return { item: serializar(doc), movimiento: null };
  // El stock inicial entra como INGRESO: queda en el libro como cualquier otro.
  return aplicar(doc, { tipo: "INGRESO", cantidad: stockInicial, motivo: "Stock inicial del alta" }, ctx);
}

// --- Ingreso de mercadería (ADMIN, requisito 7) ----------------------------

async function ingreso(idCrudo, body, ctx) {
  const id = idValido(idCrudo);
  cuerpo(body);
  const cantidad = cantidadPositiva(body.cantidad);
  const motivo = textoOpcional(body.motivo, "motivo") || "Ingreso de mercadería";
  return conLock(id, async () => aplicar(await buscar(id), { tipo: "INGRESO", cantidad, motivo }, ctx), {
    esperaMs: config.lockTtlMs,
  });
}

// --- Ajuste por error de conteo (ADMIN, requisito 7) -----------------------
// `cantidad` es la corrección con signo (-2: había 2 menos de lo registrado).
// Exige motivo: al auditar se distingue de un ingreso.
async function ajuste(idCrudo, body, ctx) {
  const id = idValido(idCrudo);
  cuerpo(body);
  const errores = [];
  if (!Number.isInteger(body.cantidad) || body.cantidad === 0) {
    errores.push("El campo cantidad debe ser un entero distinto de 0 (positivo suma, negativo resta).");
  }
  if (typeof body.motivo !== "string" || body.motivo.trim().length < MOTIVO_MIN) {
    errores.push(`El ajuste exige un motivo (mínimo ${MOTIVO_MIN} caracteres).`);
  }
  if (errores.length) throw invalido(errores);
  const motivo = body.motivo.trim().slice(0, 200);

  return conLock(
    id,
    async () => {
      const repuesto = await buscar(id);
      if (repuesto.stock + body.cantidad < 0) {
        throw new ErrorHttp(409, "Ajuste inválido.", [
          `El stock de ${repuesto.codigo} es ${repuesto.stock}: un ajuste de ${body.cantidad} lo dejaría negativo.`,
        ]);
      }
      return aplicar(repuesto, { tipo: "AJUSTE", cantidad: body.cantidad, motivo }, ctx);
    },
    { esperaMs: config.lockTtlMs }
  );
}

// --- Descuento por una orden (MECANICO, ADMIN — requisito 8) ---------------
// check-then-act con el retardo de la demo entre lectura y escritura; el lock de
// Redis es quien serializa (a propósito no hay filtro { stock: { $gte } }).
//
// Ligado a la orden (ordenId obligatorio):
//  - si esa orden ya descontó este repuesto → 200 con el movimiento existente
//    (idempotente: un reintento después de un timeout no descuenta dos veces);
//  - si esa orden ya fue repuesta (cancelada/fallida) → 409: un descuento que
//    llega tarde no puede volver a sacar stock de una orden cerrada.
async function descontarParaOrden(id, cantidad, ordenId, ctx) {
  const repuesto = await buscar(id);
  const previos = await Movimiento.find({ ordenId, repuestoId: id, tipo: { $in: ["DESCUENTO", "REPOSICION"] } });
  if (previos.some((m) => m.tipo === "REPOSICION")) {
    throw new ErrorHttp(409, "Orden cerrada.", [`La orden ${ordenId} ya fue repuesta: no se puede descontar para ella.`]);
  }
  const previo = previos.find((m) => m.tipo === "DESCUENTO");
  if (previo) {
    logger.info(`Descuento repetido orden=${ordenId} ${repuesto.codigo}: se devuelve el movimiento existente (idempotente).`);
    return { item: serializar(repuesto), movimiento: serializarMovimiento(previo), repetido: true };
  }
  if (repuesto.stock < cantidad) {
    const err = new ErrorHttp(409, "Stock insuficiente.", [
      `Stock disponible de ${repuesto.codigo}: ${repuesto.stock}, solicitado: ${cantidad}.`,
    ]);
    err.item = serializar(repuesto);
    throw err;
  }
  await esperar(config.demoDelayMs);
  return aplicar(repuesto, { tipo: "DESCUENTO", cantidad: -cantidad, ordenId }, ctx);
}

async function descontar(idCrudo, body, ctx) {
  const id = idValido(idCrudo);
  cuerpo(body);
  const cantidad = cantidadPositiva(body.cantidad, 1);
  const ordenId = idValido(body.ordenId, "ordenId (orden de trabajo que consume el repuesto)");
  const resultado = await conLock(id, async (adquirido) => ({
    ...(await descontarParaOrden(id, cantidad, ordenId, ctx)),
    lock: adquirido.key,
  }));
  return { ...resultado, proteccion: true };
}

// --- Reposición (requisito 10) ----------------------------------------------
// Devuelve al stock exactamente lo que el libro dice que descontó la orden, con
// un movimiento REPOSICION por repuesto (contramovimiento, no rollback).
// Idempotente: si ya se repuso, informa y no vuelve a sumar.
//
// `repuestoIds` (opcional): repuestos que la orden intentó descontar aunque el
// resultado sea incierto (timeout). Para cada uno se toma el lock y se consulta
// el libro: si el descuento se aplicó, se devuelve; si no, se deja una
// REPOSICION de 0 que impide que un descuento tardío de esa orden se aplique.
//
// Propiedad: puede reponer quien hizo los descuentos (el dueño de la orden,
// porque workorders-service propaga su token) o un ADMIN.
async function reponer(body, ctx) {
  cuerpo(body);
  const ordenId = idValido(body.ordenId, "ordenId");
  const extra = body.repuestoIds === undefined ? [] : body.repuestoIds;
  if (!Array.isArray(extra) || extra.length > 20) throw invalido(["repuestoIds debe ser un arreglo de hasta 20 ids."]);
  const motivo = textoOpcional(body.motivo, "motivo") || "Reposición de la orden";

  const descuentos = await Movimiento.find({ ordenId, tipo: "DESCUENTO" });
  const ajenos = descuentos.filter((m) => m.usuario !== ctx.usuario.id);
  if (ctx.usuario.rol !== "ADMIN" && ajenos.length) {
    throw new ErrorHttp(403, "Permisos insuficientes.", ["Los descuentos de esa orden los hizo otro usuario."]);
  }

  const ids = [...new Set([...descuentos.map((m) => m.repuestoId), ...extra.map((r) => idValido(r, "repuestoIds[]"))])].sort();
  const items = [];
  for (const id of ids) {
    const r = await conLock(
      id,
      async () => {
        const repuesto = await Repuesto.findById(id);
        if (!repuesto) return { repuestoId: id, estado: "REPUESTO_INEXISTENTE", repuesto: 0 };
        const previos = await Movimiento.find({ ordenId, repuestoId: id, tipo: { $in: ["DESCUENTO", "REPOSICION"] } });
        const ya = previos.find((m) => m.tipo === "REPOSICION");
        const desc = previos.find((m) => m.tipo === "DESCUENTO");
        const descontado = desc ? -desc.cantidad : 0;
        if (ya) return { repuestoId: id, codigo: repuesto.codigo, descontado, repuesto: ya.cantidad, estado: "YA_REPUESTO", stock: repuesto.stock };
        try {
          const { item } = await aplicar(repuesto, { tipo: "REPOSICION", cantidad: descontado, ordenId, motivo }, ctx);
          return {
            repuestoId: id,
            codigo: repuesto.codigo,
            descontado,
            repuesto: descontado,
            estado: descontado > 0 ? "REPUESTO" : "SIN_DESCUENTO",
            stock: item.stock,
          };
        } catch (err) {
          // Carrera entre dos reposiciones de la misma orden: ganó la otra.
          if (err.code === 11000) return { repuestoId: id, codigo: repuesto.codigo, descontado, repuesto: descontado, estado: "YA_REPUESTO" };
          throw err;
        }
      },
      { esperaMs: config.lockTtlMs + 1000 }
    );
    items.push(r);
  }
  const total = items.filter((i) => i.estado === "REPUESTO").reduce((s, i) => s + i.repuesto, 0);
  logger.info(`Reposición orden=${ordenId}: ${items.map((i) => `${i.codigo || i.repuestoId}:${i.estado}`).join(", ") || "nada que reponer"} sub=${ctx.usuario.id}.`);
  return { ordenId, unidadesRepuestas: total, items };
}

// --- Laboratorio (solo con LAB_ENDPOINTS=true, requisito 16) ---------------

async function estadoLock(idCrudo) {
  const id = idValido(idCrudo);
  try {
    return await lock.inspeccionar("repuesto", id);
  } catch (err) {
    if (err.codigo === "redis_down") throw redisCaido();
    throw err;
  }
}

// Demo de la condición de carrera del TP2: mismo check-then-act, SIN lock. El
// libro registra cada descuento con el saldo real, así la carrera queda a la vista.
async function descontarSinLock(idCrudo, body, ctx) {
  const id = idValido(idCrudo);
  cuerpo(body);
  const cantidad = cantidadPositiva(body.cantidad, 1);
  const repuesto = await buscar(id);
  if (repuesto.stock < cantidad) {
    const err = new ErrorHttp(409, "Stock insuficiente.", [`Stock disponible de ${repuesto.codigo}: ${repuesto.stock}, solicitado: ${cantidad}.`]);
    err.item = serializar(repuesto);
    throw err;
  }
  await esperar(config.demoDelayMs);
  const r = await aplicar(repuesto, { tipo: "DESCUENTO", cantidad: -cantidad, motivo: "LABORATORIO: descontar-sin-lock" }, ctx);
  return { ...r, proteccion: false };
}

async function reiniciar() {
  await reiniciarRepuestos();
  return listar();
}

module.exports = {
  listar,
  obtener,
  movimientos,
  crear,
  ingreso,
  ajuste,
  descontar,
  reponer,
  estadoLock,
  descontarSinLock,
  reiniciar,
};
