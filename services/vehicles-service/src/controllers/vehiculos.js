const servicio = require("../services/vehiculos");

// Adaptan la request HTTP al caso de uso y arman la respuesta.
// Los errores (ErrorHttp, Mongo caído, etc.) los resuelve el middleware de app.js.

async function listar(req, res) {
  res.status(200).json(await servicio.listar());
}

async function obtener(req, res) {
  res.status(200).json(await servicio.obtener(req.params.id));
}

async function crear(req, res) {
  res.status(201).json(await servicio.crear(req.body));
}

async function reemplazar(req, res) {
  res.status(200).json(await servicio.reemplazar(req.params.id, req.body));
}

async function eliminar(req, res) {
  await servicio.eliminar(req.params.id);
  res.status(204).send();
}

module.exports = { listar, obtener, crear, reemplazar, eliminar };
