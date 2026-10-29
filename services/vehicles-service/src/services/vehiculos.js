const Vehiculo = require("../models/vehiculo");
const logger = require("../config/logger");
const { ErrorHttp, invalido, interpretarErrorPersistencia } = require("../utils/errores");
const { parsearObjectId, esObjetoJson } = require("../utils/ids");

// Reglas de negocio de la flota: validación de campos y patente única.
// Es la única autoridad sobre la colección `vehiculos`.

function serializar(doc) {
  return {
    id: String(doc._id),
    marca: doc.marca,
    modelo: doc.modelo,
    anio: doc.anio,
    patente: doc.patente,
    kilometraje: doc.kilometraje,
  };
}

function camposVehiculo(body) {
  if (!esObjetoJson(body)) {
    throw invalido(["El body debe ser un objeto JSON."]);
  }
  return {
    marca: body.marca,
    modelo: body.modelo,
    anio: body.anio,
    patente: body.patente,
    kilometraje: body.kilometraje,
  };
}

function idValido(valor) {
  const id = parsearObjectId(valor);
  if (id === null) {
    throw invalido(["El id debe ser un ObjectId hexadecimal de 24 caracteres."]);
  }
  return id;
}

function noEncontrado() {
  return new ErrorHttp(404, "Vehículo no encontrado.");
}

async function persistir(operacion) {
  try {
    return await operacion();
  } catch (err) {
    const interpretado = interpretarErrorPersistencia(err);
    if (interpretado) {
      throw interpretado;
    }
    throw err;
  }
}

async function listar() {
  const docs = await Vehiculo.find().sort({ patente: 1 });
  return docs.map(serializar);
}

async function obtener(idCrudo) {
  const id = idValido(idCrudo);
  const doc = await Vehiculo.findById(id);
  if (!doc) {
    throw noEncontrado();
  }
  return serializar(doc);
}

async function crear(body) {
  const campos = camposVehiculo(body);
  const creado = await persistir(() => Vehiculo.create(campos));
  logger.info(`Vehículo creado id=${creado._id} patente=${creado.patente}.`);
  return serializar(creado);
}

async function reemplazar(idCrudo, body) {
  const id = idValido(idCrudo);
  const campos = camposVehiculo(body);
  const existente = await Vehiculo.findById(id);
  if (!existente) {
    throw noEncontrado();
  }
  existente.set(campos);
  const actualizado = await persistir(() => existente.save());
  logger.info(`Vehículo actualizado id=${id} patente=${actualizado.patente}.`);
  return serializar(actualizado);
}

async function eliminar(idCrudo) {
  const id = idValido(idCrudo);
  const eliminado = await Vehiculo.findByIdAndDelete(id);
  if (!eliminado) {
    throw noEncontrado();
  }
  logger.info(`Vehículo eliminado id=${id} patente=${eliminado.patente}.`);
}

module.exports = { listar, obtener, crear, reemplazar, eliminar };
