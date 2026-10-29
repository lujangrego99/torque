const servicio = require("../services/repuestos");

// Adaptan la request HTTP al caso de uso y arman la respuesta.
// Los errores los resuelve el middleware de app.js.

async function listar(req, res) {
  res.status(200).json(await servicio.listar());
}

async function obtener(req, res) {
  res.status(200).json(await servicio.obtener(req.params.id));
}

async function estadoLock(req, res) {
  res.status(200).json(await servicio.estadoLock(req.params.id));
}

async function descontarSinLock(req, res) {
  const resultado = await servicio.descontarSinLock(req.params.id, req.body);
  res.status(200).json({ mensaje: "Stock descontado.", ...resultado });
}

async function descontar(req, res) {
  const resultado = await servicio.descontar(req.params.id, req.body);
  res.status(200).json({ mensaje: "Stock descontado.", ...resultado });
}

async function reiniciar(req, res) {
  res.status(200).json({ mensaje: "Stock restaurado a la semilla.", items: await servicio.reiniciar() });
}

module.exports = { listar, obtener, estadoLock, descontarSinLock, descontar, reiniciar };
