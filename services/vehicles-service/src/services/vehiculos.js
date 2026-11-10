const Vehiculo = require("../models/vehiculo");
const logger = require("../config/logger");
const { ErrorHttp, invalido, interpretarErrorPersistencia } = require("../utils/errores");
const { parsearObjectId, esObjetoJson } = require("../utils/ids");

// Reglas de negocio del parque de vehículos. Única autoridad sobre `vehiculos`.
//  - Una patente es un auto: no se carga dos veces (se devuelve el existente).
//  - El vehículo guarda nombre y teléfono del dueño (obligatorios).
//  - La baja es lógica: el auto queda inactivo y conserva su historial.

function serializar(doc) {
  return {
    id: String(doc._id),
    marca: doc.marca,
    modelo: doc.modelo,
    anio: doc.anio,
    patente: doc.patente,
    kilometraje: doc.kilometraje,
    duenio: doc.duenio ? { nombre: doc.duenio.nombre, telefono: doc.duenio.telefono } : null,
    activo: doc.activo !== false,
    ...(doc.baja && doc.baja.fecha ? { baja: { fecha: doc.baja.fecha, por: doc.baja.por, motivo: doc.baja.motivo } } : {}),
  };
}

function normalizarPatente(valor) {
  return typeof valor === "string" ? valor.trim().toUpperCase().replace(/[\s-]/g, "") : valor;
}

function camposVehiculo(body) {
  if (!esObjetoJson(body)) {
    throw invalido(["El body debe ser un objeto JSON."]);
  }
  if (body.duenio !== undefined && !esObjetoJson(body.duenio)) {
    throw invalido(["duenio debe ser un objeto { nombre, telefono }."]);
  }
  return {
    marca: body.marca,
    modelo: body.modelo,
    anio: body.anio,
    patente: normalizarPatente(body.patente),
    kilometraje: body.kilometraje,
    duenio: body.duenio ? { nombre: body.duenio.nombre, telefono: body.duenio.telefono } : undefined,
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

// Patente ya cargada: 409 con el vehículo existente en el cuerpo, para que el
// cliente lo use (p. ej. para crear la orden nueva) en lugar de duplicarlo.
async function duplicado(patente) {
  const existente = await Vehiculo.findOne({ patente });
  return new ErrorHttp(
    409,
    "Vehículo ya registrado.",
    [`La patente ${patente} ya está cargada${existente && existente.activo === false ? " (dado de baja)" : ""}. Usar el vehículo existente.`],
    existente ? { vehiculoExistente: serializar(existente) } : undefined
  );
}

async function persistir(operacion, patente) {
  try {
    return await operacion();
  } catch (err) {
    if (err.code === 11000 && patente) throw await duplicado(patente);
    const interpretado = interpretarErrorPersistencia(err);
    if (interpretado) {
      throw interpretado;
    }
    throw err;
  }
}

// Por defecto solo los activos. ?patente=AB123CD busca un auto puntual (incluye
// inactivos: sirve para detectar si ya está cargado). ?incluirInactivos=true trae todos.
async function listar(filtros = {}) {
  const query = {};
  if (filtros.patente !== undefined) {
    query.patente = normalizarPatente(String(filtros.patente));
  } else if (filtros.incluirInactivos !== "true") {
    query.activo = { $ne: false };
  }
  const docs = await Vehiculo.find(query).sort({ patente: 1 });
  return docs.map(serializar);
}

// Devuelve el vehículo aunque esté dado de baja (con activo=false): el
// historial y las órdenes viejas lo siguen necesitando.
async function obtener(idCrudo) {
  const id = idValido(idCrudo);
  const doc = await Vehiculo.findById(id);
  if (!doc) {
    throw noEncontrado();
  }
  return serializar(doc);
}

async function porPatente(patenteCruda) {
  const doc = await Vehiculo.findOne({ patente: normalizarPatente(patenteCruda) });
  if (!doc) throw new ErrorHttp(404, "Vehículo no encontrado.", [`No hay un vehículo con patente ${normalizarPatente(patenteCruda)}.`]);
  return serializar(doc);
}

async function crear(body, usuario) {
  const campos = camposVehiculo(body);
  // Detección explícita del duplicado (el índice único cubre la carrera entre dos altas).
  if (typeof campos.patente === "string" && (await Vehiculo.exists({ patente: campos.patente }))) {
    throw await duplicado(campos.patente);
  }
  const creado = await persistir(() => Vehiculo.create(campos), campos.patente);
  logger.info(`Vehículo creado id=${creado._id} patente=${creado.patente} sub=${usuario.id}.`);
  return serializar(creado);
}

async function reemplazar(idCrudo, body, usuario) {
  const id = idValido(idCrudo);
  const campos = camposVehiculo(body);
  const existente = await Vehiculo.findById(id);
  if (!existente) {
    throw noEncontrado();
  }
  if (existente.activo === false) {
    throw new ErrorHttp(409, "Vehículo dado de baja.", ["Un vehículo inactivo no se modifica. Un ADMIN puede reactivarlo."]);
  }
  existente.set(campos);
  const actualizado = await persistir(() => existente.save(), campos.patente);
  logger.info(`Vehículo actualizado id=${id} patente=${actualizado.patente} sub=${usuario.id}.`);
  return serializar(actualizado);
}

// Baja lógica (ADMIN). Idempotente: dar de baja un auto ya inactivo no cambia nada.
async function darDeBaja(idCrudo, body, usuario) {
  const id = idValido(idCrudo);
  const motivo = esObjetoJson(body) && typeof body.motivo === "string" ? body.motivo.trim().slice(0, 200) : undefined;
  const doc = await Vehiculo.findById(id);
  if (!doc) throw noEncontrado();
  if (doc.activo !== false) {
    doc.activo = false;
    doc.baja = { fecha: new Date(), por: usuario.id, motivo };
    await doc.save({ validateModifiedOnly: true });
    logger.info(`Vehículo dado de baja (lógica) id=${id} patente=${doc.patente} sub=${usuario.id}.`);
  }
  return serializar(doc);
}

async function reactivar(idCrudo, usuario) {
  const id = idValido(idCrudo);
  const doc = await Vehiculo.findById(id);
  if (!doc) throw noEncontrado();
  if (doc.activo === false) {
    doc.activo = true;
    doc.baja = undefined;
    await doc.save({ validateModifiedOnly: true });
    logger.info(`Vehículo reactivado id=${id} patente=${doc.patente} sub=${usuario.id}.`);
  }
  return serializar(doc);
}

module.exports = { listar, obtener, porPatente, crear, reemplazar, darDeBaja, reactivar };
