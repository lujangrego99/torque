const Repuesto = require("../models/repuesto");
const lock = require("../config/lock");
const config = require("../config");
const logger = require("../config/logger");
const { reiniciarRepuestos } = require("../models/seed");
const { ErrorHttp, invalido } = require("../utils/errores");
const { parsearObjectId, esObjetoJson } = require("../utils/ids");

// Reglas de stock: cantidad entera positiva, rechazo por stock insuficiente y
// exclusión mutua con Redis en el descuento seguro. Único dueño de `repuestos`.

function serializar(doc) {
  return { id: String(doc._id), nombre: doc.nombre, codigo: doc.codigo, stock: doc.stock };
}

function idValido(valor) {
  const id = parsearObjectId(valor);
  if (id === null) {
    throw invalido(["El id debe ser un ObjectId hexadecimal de 24 caracteres."]);
  }
  return id;
}

function cantidadValida(body) {
  if (!esObjetoJson(body)) {
    throw invalido(["El body debe ser un objeto JSON."]);
  }
  const cantidad = body.cantidad === undefined ? 1 : body.cantidad;
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw invalido(["El campo cantidad debe ser un entero positivo."]);
  }
  return cantidad;
}

function redisCaido() {
  return new ErrorHttp(503, "No se pudo coordinar el acceso al recurso.", ["Redis/Memurai no está disponible."]);
}

function esperar(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

// check-then-act con retardo artificial entre lectura y escritura. Sin lock,
// otra request entra en esa ventana y el stock queda negativo. A propósito NO
// hay filtro { stock: { $gte } }: el lock es quien serializa (TP2/TP3).
async function ejecutarDescuento(id, cantidad) {
  const existente = await Repuesto.findById(id);
  if (!existente) {
    throw new ErrorHttp(404, "Repuesto no encontrado.");
  }
  if (existente.stock < cantidad) {
    const err = new ErrorHttp(409, "Stock insuficiente.", [
      `Stock disponible de ${existente.codigo}: ${existente.stock}, solicitado: ${cantidad}.`,
    ]);
    err.item = serializar(existente);
    throw err;
  }
  await esperar(config.demoDelayMs);
  const actualizado = await Repuesto.findByIdAndUpdate(id, { $inc: { stock: -cantidad } }, { new: true });
  logger.info(`Stock descontado id=${id} cantidad=${cantidad} stock=${actualizado.stock}.`);
  return serializar(actualizado);
}

async function listar() {
  const docs = await Repuesto.find().sort({ codigo: 1 });
  return docs.map(serializar);
}

async function obtener(idCrudo) {
  const id = idValido(idCrudo);
  const doc = await Repuesto.findById(id);
  if (!doc) {
    throw new ErrorHttp(404, "Repuesto no encontrado.");
  }
  return serializar(doc);
}

async function estadoLock(idCrudo) {
  const id = idValido(idCrudo);
  try {
    return await lock.inspeccionar("repuesto", id);
  } catch (err) {
    if (err.codigo === "redis_down") throw redisCaido();
    throw err;
  }
}

async function descontarSinLock(idCrudo, body) {
  const id = idValido(idCrudo);
  const cantidad = cantidadValida(body);
  return { item: await ejecutarDescuento(id, cantidad), proteccion: false };
}

async function descontar(idCrudo, body) {
  const id = idValido(idCrudo);
  const cantidad = cantidadValida(body);

  let adquirido = null;
  try {
    adquirido = await lock.adquirir("repuesto", id);
    if (!adquirido) {
      throw new ErrorHttp(409, "Recurso ocupado.", [
        `Otra operación está modificando el stock del repuesto ${id}. Reintentar.`,
      ]);
    }
    return { item: await ejecutarDescuento(id, cantidad), proteccion: true, lock: adquirido.key };
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

async function reiniciar() {
  await reiniciarRepuestos();
  return listar();
}

module.exports = { listar, obtener, estadoLock, descontarSinLock, descontar, reiniciar };
