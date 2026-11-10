const servicio = require("../services/vehiculos");

// Adaptan la request HTTP al caso de uso y arman la respuesta.
// Los errores (ErrorHttp, Mongo caído, etc.) los resuelve el middleware de app.js.

async function listar(req, res) {
  res.status(200).json(await servicio.listar(req.query));
}

async function obtener(req, res) {
  res.status(200).json(await servicio.obtener(req.params.id));
}

async function porPatente(req, res) {
  res.status(200).json(await servicio.porPatente(req.params.patente));
}

async function crear(req, res) {
  const v = await servicio.crear(req.body, req.usuario);
  res.status(201).location(`/api/vehiculos/${v.id}`).json(v);
}

async function reemplazar(req, res) {
  res.status(200).json(await servicio.reemplazar(req.params.id, req.body, req.usuario));
}

// Baja lógica: 200 con el vehículo inactivo (no se borra).
async function darDeBaja(req, res) {
  res.status(200).json(await servicio.darDeBaja(req.params.id, req.body, req.usuario));
}

async function reactivar(req, res) {
  res.status(200).json(await servicio.reactivar(req.params.id, req.usuario));
}

module.exports = { listar, obtener, porPatente, crear, reemplazar, darDeBaja, reactivar };
