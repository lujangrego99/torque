const express = require("express");
const Repuesto = require("../models/repuesto");
const lock = require("../lock");
const logger = require("../logger");
const { esperar } = require("../utils/delay");
const { parsearObjectId, esObjetoJson } = require("../utils/ids");
const { serializarRepuesto } = require("../utils/serializar");
const { reiniciarRepuestos } = require("../seed");

const router = express.Router();

function parsearCantidad(body) {
  if (!esObjetoJson(body)) {
    return { error: "El body debe ser un objeto JSON." };
  }

  const cantidad = body.cantidad === undefined ? 1 : body.cantidad;
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    return { error: "El campo cantidad debe ser un entero positivo." };
  }

  return { cantidad };
}

function delayDemoMs() {
  const valor = Number(process.env.DEMO_DELAY_MS);
  return Number.isInteger(valor) && valor > 0 ? valor : 0;
}

function responderErrores(res, errores) {
  return res.status(400).json({ error: "Datos inválidos o incompletos.", detalles: errores });
}

function responderRedisCaido(res) {
  logger.error("Redis/Memurai no está disponible para coordinar el lock.");
  return res.status(503).json({
    error: "No se pudo coordinar el acceso al recurso.",
    detalles: ["Redis/Memurai no está disponible."],
  });
}

async function ejecutarDescuento(id, cantidad) {
  const existente = await Repuesto.findById(id);
  if (!existente) {
    return { ok: false, codigo: "no_encontrado" };
  }

  if (existente.stock < cantidad) {
    return { ok: false, codigo: "sin_stock", item: existente };
  }

  // Retardo artificial entre la lectura y la escritura. Sin lock, otra
  // solicitud entra en esa ventana, también ve stock suficiente y las dos
  // hacen $inc: el stock queda negativo (check-then-act). El lock de Redis
  // sigue siendo quien serializa la sección crítica; no hay filtro
  // { stock: { $gte: cantidad } } a propósito.
  await esperar(delayDemoMs());

  const actualizado = await Repuesto.findByIdAndUpdate(
    id,
    { $inc: { stock: -cantidad } },
    { new: true }
  );
  return { ok: true, item: actualizado };
}

function responderDescuento(res, resultado, extra) {
  if (resultado.codigo === "no_encontrado") {
    logger.warn("Descuento: repuesto no encontrado.");
    return res.status(404).json({ error: "Repuesto no encontrado." });
  }

  if (resultado.codigo === "sin_stock") {
    logger.warn(
      `Descuento rechazado por stock insuficiente id=${resultado.item._id} stock=${resultado.item.stock}.`
    );
    return res.status(409).json({
      error: "Stock insuficiente.",
      item: serializarRepuesto(resultado.item),
    });
  }

  logger.info(
    `Stock descontado id=${resultado.item._id} stock=${resultado.item.stock} proteccion=${Boolean(
      extra && extra.proteccion
    )}.`
  );
  return res.status(200).json({
    mensaje: "Stock descontado.",
    item: serializarRepuesto(resultado.item),
    ...extra,
  });
}

router.get("/", async (req, res, next) => {
  try {
    const docs = await Repuesto.find().sort({ codigo: 1 });
    return res.status(200).json(docs.map(serializarRepuesto));
  } catch (err) {
    return next(err);
  }
});

router.post("/reiniciar", async (req, res, next) => {
  try {
    const items = await reiniciarRepuestos();
    return res.status(200).json({
      mensaje: "Stock restaurado a la semilla.",
      items,
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  const id = parsearObjectId(req.params.id);
  if (id === null) {
    logger.warn(`GET /api/repuestos/${req.params.id}: identificador inválido.`);
    return responderErrores(res, ["El id debe ser un ObjectId hexadecimal de 24 caracteres."]);
  }

  try {
    const item = await Repuesto.findById(id);
    if (!item) {
      logger.warn(`GET /api/repuestos/${id}: no encontrado.`);
      return res.status(404).json({ error: "Repuesto no encontrado." });
    }
    return res.status(200).json(serializarRepuesto(item));
  } catch (err) {
    return next(err);
  }
});

router.get("/:id/lock", async (req, res) => {
  const id = parsearObjectId(req.params.id);
  if (id === null) {
    return responderErrores(res, ["El id debe ser un ObjectId hexadecimal de 24 caracteres."]);
  }

  try {
    const estado = await lock.inspeccionar("repuesto", id);
    return res.status(200).json(estado);
  } catch (err) {
    if (err.codigo === "redis_down") {
      return responderRedisCaido(res);
    }
    throw err;
  }
});

router.post("/:id/descontar-sin-lock", async (req, res, next) => {
  const id = parsearObjectId(req.params.id);
  if (id === null) {
    return responderErrores(res, ["El id debe ser un ObjectId hexadecimal de 24 caracteres."]);
  }

  const parsed = parsearCantidad(req.body);
  if (parsed.error) {
    logger.warn(`POST descontar-sin-lock: ${parsed.error}`);
    return responderErrores(res, [parsed.error]);
  }

  try {
    const resultado = await ejecutarDescuento(id, parsed.cantidad);
    return responderDescuento(res, resultado, { proteccion: false });
  } catch (err) {
    return next(err);
  }
});

router.post("/:id/descontar", async (req, res, next) => {
  const id = parsearObjectId(req.params.id);
  if (id === null) {
    return responderErrores(res, ["El id debe ser un ObjectId hexadecimal de 24 caracteres."]);
  }

  const parsed = parsearCantidad(req.body);
  if (parsed.error) {
    logger.warn(`POST descontar: ${parsed.error}`);
    return responderErrores(res, [parsed.error]);
  }

  let adquirido = null;

  try {
    adquirido = await lock.adquirir("repuesto", id);
    if (!adquirido) {
      logger.warn(`Recurso ocupado lock:repuesto:${id}.`);
      return res.status(409).json({
        error: "Recurso ocupado.",
        detalles: [
          `Otra operación está modificando el stock del repuesto ${id}. Reintentar.`,
        ],
      });
    }

    const resultado = await ejecutarDescuento(id, parsed.cantidad);
    return responderDescuento(res, resultado, {
      proteccion: true,
      lock: adquirido.key,
    });
  } catch (err) {
    if (err.codigo === "redis_down") {
      return responderRedisCaido(res);
    }
    return next(err);
  } finally {
    if (adquirido) {
      try {
        await lock.liberar(adquirido);
      } catch (err) {
        logger.error(`No se pudo liberar el lock ${adquirido.key}: ${err.message}`);
      }
    }
  }
});

module.exports = router;
