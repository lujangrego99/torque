const servicio = require("../services/usuarios");

// Adaptan la request HTTP al caso de uso y arman la respuesta.
// Los errores los resuelve el middleware de app.js.

async function registrar(req, res) {
  res.status(201).json(await servicio.registrar(req.body));
}

async function login(req, res) {
  res.status(200).json(await servicio.login(req.body, req.id));
}

async function perfil(req, res) {
  res.status(200).json(await servicio.perfil(req.usuario.id));
}

async function listar(req, res) {
  res.status(200).json(await servicio.listar());
}

async function actualizar(req, res) {
  res.status(200).json(await servicio.actualizar(req.params.id, req.body, req.usuario));
}

module.exports = { registrar, login, perfil, listar, actualizar };
