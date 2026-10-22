const express = require("express");
const Vehiculo = require("../models/vehiculo");
const logger = require("../logger");
const { parsearObjectId, esObjetoJson } = require("../utils/ids");
const { interpretarErrorPersistencia } = require("../utils/errores");
const { serializarVehiculo } = require("../utils/serializar");

const router = express.Router();

function camposVehiculo(body) {
  return {
    marca: body.marca,
    modelo: body.modelo,
    anio: body.anio,
    patente: body.patente,
    kilometraje: body.kilometraje,
  };
}

function responderErrores(res, errores) {
  return res.status(400).json({ error: "Datos inválidos o incompletos.", detalles: errores });
}

function responderPersistencia(res, interpretado) {
  return res.status(interpretado.status).json({
    error: interpretado.error,
    detalles: interpretado.detalles,
  });
}

router.get("/", async (req, res, next) => {
  try {
    const docs = await Vehiculo.find().sort({ patente: 1 });
    logger.info(`Listado de vehículos: ${docs.length} documentos.`);
    return res.status(200).json(docs.map(serializarVehiculo));
  } catch (err) {
    return next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  const id = parsearObjectId(req.params.id);
  if (id === null) {
    logger.warn(`GET /api/vehiculos/${req.params.id}: identificador inválido.`);
    return responderErrores(res, ["El id debe ser un ObjectId hexadecimal de 24 caracteres."]);
  }

  try {
    const doc = await Vehiculo.findById(id);
    if (!doc) {
      logger.warn(`GET /api/vehiculos/${id}: no encontrado.`);
      return res.status(404).json({ error: "Vehículo no encontrado." });
    }
    return res.status(200).json(serializarVehiculo(doc));
  } catch (err) {
    return next(err);
  }
});

router.post("/", async (req, res, next) => {
  if (!esObjetoJson(req.body)) {
    logger.warn("POST /api/vehiculos: body inválido.");
    return responderErrores(res, ["El body debe ser un objeto JSON."]);
  }

  try {
    const creado = await Vehiculo.create(camposVehiculo(req.body));
    logger.info(`Vehículo creado id=${creado._id} patente=${creado.patente}.`);
    return res.status(201).json(serializarVehiculo(creado));
  } catch (err) {
    const interpretado = interpretarErrorPersistencia(err);
    if (interpretado) {
      if (interpretado.status === 409) {
        logger.warn(`POST /api/vehiculos: conflicto de unicidad (${interpretado.detalles.join("; ")}).`);
      } else {
        logger.warn(`POST /api/vehiculos: validación rechazada (${interpretado.detalles.join("; ")}).`);
      }
      return responderPersistencia(res, interpretado);
    }
    return next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  const id = parsearObjectId(req.params.id);
  if (id === null) {
    logger.warn(`PUT /api/vehiculos/${req.params.id}: identificador inválido.`);
    return responderErrores(res, ["El id debe ser un ObjectId hexadecimal de 24 caracteres."]);
  }

  if (!esObjetoJson(req.body)) {
    logger.warn(`PUT /api/vehiculos/${id}: body inválido.`);
    return responderErrores(res, ["El body debe ser un objeto JSON."]);
  }

  try {
    const existente = await Vehiculo.findById(id);
    if (!existente) {
      logger.warn(`PUT /api/vehiculos/${id}: no encontrado.`);
      return res.status(404).json({ error: "Vehículo no encontrado." });
    }

    existente.set(camposVehiculo(req.body));
    const actualizado = await existente.save();
    logger.info(`Vehículo actualizado id=${id} patente=${actualizado.patente}.`);
    return res.status(200).json(serializarVehiculo(actualizado));
  } catch (err) {
    const interpretado = interpretarErrorPersistencia(err);
    if (interpretado) {
      if (interpretado.status === 409) {
        logger.warn(`PUT /api/vehiculos/${id}: conflicto de unicidad.`);
      } else {
        logger.warn(`PUT /api/vehiculos/${id}: validación rechazada (${interpretado.detalles.join("; ")}).`);
      }
      return responderPersistencia(res, interpretado);
    }
    return next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  const id = parsearObjectId(req.params.id);
  if (id === null) {
    logger.warn(`DELETE /api/vehiculos/${req.params.id}: identificador inválido.`);
    return responderErrores(res, ["El id debe ser un ObjectId hexadecimal de 24 caracteres."]);
  }

  try {
    const eliminado = await Vehiculo.findByIdAndDelete(id);
    if (!eliminado) {
      logger.warn(`DELETE /api/vehiculos/${id}: no encontrado.`);
      return res.status(404).json({ error: "Vehículo no encontrado." });
    }
    logger.info(`Vehículo eliminado id=${id} patente=${eliminado.patente}.`);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
