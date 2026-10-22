const express = require("express");
const mongoose = require("mongoose");
const Vehiculo = require("../models/vehiculo");
const logger = require("../logger");
const { parsearObjectId, esObjetoJson } = require("../utils/ids");
const { serializarVehiculo } = require("../utils/serializar");
const { responderNoLeader } = require("./raft");

const router = express.Router();

function getRaft(req) {
  return req.app.get("raft");
}

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

function validarCampos(campos) {
  const errores = [];
  if (typeof campos.marca !== "string" || !campos.marca.trim()) {
    errores.push("marca es obligatoria.");
  }
  if (typeof campos.modelo !== "string" || !campos.modelo.trim()) {
    errores.push("modelo es obligatorio.");
  }
  if (!Number.isInteger(campos.anio) || campos.anio < 1900) {
    errores.push("anio debe ser un entero >= 1900.");
  }
  if (typeof campos.patente !== "string" || !/^[A-Za-z0-9]{6,8}$/.test(campos.patente)) {
    errores.push("patente debe ser alfanumérica de 6 a 8 caracteres.");
  }
  if (!Number.isInteger(campos.kilometraje) || campos.kilometraje < 0) {
    errores.push("kilometraje debe ser un entero >= 0.");
  }
  return errores;
}

async function proponerORedirect(req, res, next, command) {
  const raft = getRaft(req);
  if (!raft.esLeader()) {
    logger.warn(`Escritura rechazada en follower ${raft.nodeId} type=${command.type}`);
    return responderNoLeader(res, raft);
  }

  try {
    const resultado = await raft.proponer(command);
    if (resultado.status === 204) {
      return res.status(204).send();
    }
    return res.status(resultado.status).json(resultado.body);
  } catch (err) {
    if (err.codigo === "not_leader") {
      return responderNoLeader(res, raft);
    }
    if (err.codigo === "raft_timeout") {
      logger.error(err.message);
      return res.status(503).json({
        error: "No se alcanzó quorum para confirmar la operación.",
        detalles: [err.message],
      });
    }
    return next(err);
  }
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

  const campos = camposVehiculo(req.body);
  const errores = validarCampos(campos);
  if (errores.length) {
    return responderErrores(res, errores);
  }

  const _id = new mongoose.Types.ObjectId().toString();
  return proponerORedirect(req, res, next, {
    type: "vehiculo.create",
    payload: { _id, ...campos },
  });
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

  const campos = camposVehiculo(req.body);
  const errores = validarCampos(campos);
  if (errores.length) {
    return responderErrores(res, errores);
  }

  const raft = getRaft(req);
  if (raft.esLeader()) {
    const existente = await Vehiculo.findById(id);
    if (!existente) {
      return res.status(404).json({ error: "Vehículo no encontrado." });
    }
  }

  return proponerORedirect(req, res, next, {
    type: "vehiculo.update",
    payload: { _id: String(id), ...campos },
  });
});

router.delete("/:id", async (req, res, next) => {
  const id = parsearObjectId(req.params.id);
  if (id === null) {
    logger.warn(`DELETE /api/vehiculos/${req.params.id}: identificador inválido.`);
    return responderErrores(res, ["El id debe ser un ObjectId hexadecimal de 24 caracteres."]);
  }

  const raft = getRaft(req);
  if (raft.esLeader()) {
    const existente = await Vehiculo.findById(id);
    if (!existente) {
      return res.status(404).json({ error: "Vehículo no encontrado." });
    }
  }

  return proponerORedirect(req, res, next, {
    type: "vehiculo.delete",
    payload: { _id: String(id) },
  });
});

module.exports = router;
