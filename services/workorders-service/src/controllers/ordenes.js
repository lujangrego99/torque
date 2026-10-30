const servicio = require("../services/ordenes");

// Adaptan la request HTTP al caso de uso y arman la respuesta.
// Los errores los resuelve el middleware de app.js.

// Contexto que necesita el caso de uso: quién opera, el token a propagar a
// vehicles/inventory y el request id para los logs.
function contexto(req) {
  return { usuario: req.usuario, token: req.token, requestId: req.id };
}

async function crear(req, res) {
  const resultado = await servicio.crear(req.body, contexto(req));
  if (resultado.status === 201) {
    return res.status(201).json(resultado.orden);
  }
  // La orden quedó registrada como FALLIDA: se devuelve para que el cliente vea qué pasó con cada ítem.
  return res.status(resultado.status).json({ error: resultado.error, orden: resultado.orden });
}

async function listar(req, res) {
  res.status(200).json(await servicio.listar(req.query, req.usuario));
}

async function obtener(req, res) {
  res.status(200).json(await servicio.obtener(req.params.id, req.usuario));
}

module.exports = { crear, listar, obtener };
