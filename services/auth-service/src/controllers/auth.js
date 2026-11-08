const servicio = require("../services/usuarios");

// Adaptan la request HTTP al caso de uso y arman la respuesta.
// Los errores los resuelve el middleware de app.js.

async function login(req, res) {
  res.status(200).json(await servicio.login(req.body, req.id));
}

async function renovar(req, res) {
  res.status(200).json(await servicio.renovar(req.body, req.id));
}

async function cerrarSesion(req, res) {
  await servicio.cerrarSesion(req.body, req.id);
  res.status(204).send();
}

async function perfil(req, res) {
  res.status(200).json(await servicio.perfil(req.usuario.id));
}

async function crearUsuario(req, res) {
  const usuario = await servicio.crearUsuario(req.body, req.usuario);
  res.status(201).location(`/api/auth/usuarios/${usuario.id}`).json(usuario);
}

async function listar(req, res) {
  res.status(200).json(await servicio.listar());
}

async function actualizar(req, res) {
  res.status(200).json(await servicio.actualizar(req.params.id, req.body, req.usuario));
}

module.exports = { login, renovar, cerrarSesion, perfil, crearUsuario, listar, actualizar };
