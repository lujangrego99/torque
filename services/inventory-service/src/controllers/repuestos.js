const servicio = require("../services/repuestos");

// Adaptan la request HTTP al caso de uso y arman la respuesta.
// Los errores los resuelve el middleware de app.js.

// Quién opera (sub y rol del token) y el request id: van a cada movimiento.
function ctx(req) {
  return { usuario: req.usuario, requestId: req.id };
}

async function listar(req, res) {
  res.status(200).json(await servicio.listar());
}

async function obtener(req, res) {
  res.status(200).json(await servicio.obtener(req.params.id));
}

async function movimientos(req, res) {
  res.status(200).json(await servicio.movimientos(req.query, ctx(req)));
}

async function crear(req, res) {
  const r = await servicio.crear(req.body, ctx(req));
  res.status(201).location(`/api/repuestos/${r.item.id}`).json({ mensaje: "Repuesto creado.", ...r });
}

async function ingreso(req, res) {
  res.status(200).json({ mensaje: "Ingreso registrado.", ...(await servicio.ingreso(req.params.id, req.body, ctx(req))) });
}

async function ajuste(req, res) {
  res.status(200).json({ mensaje: "Ajuste registrado.", ...(await servicio.ajuste(req.params.id, req.body, ctx(req))) });
}

async function descontar(req, res) {
  const r = await servicio.descontar(req.params.id, req.body, ctx(req));
  res.status(200).json({ mensaje: r.repetido ? "Descuento ya registrado para esa orden (sin cambios)." : "Stock descontado.", ...r });
}

async function reponer(req, res) {
  res.status(200).json({ mensaje: "Reposición procesada.", ...(await servicio.reponer(req.body, ctx(req))) });
}

async function estadoLock(req, res) {
  res.status(200).json(await servicio.estadoLock(req.params.id));
}

async function descontarSinLock(req, res) {
  res.status(200).json({ mensaje: "Stock descontado.", ...(await servicio.descontarSinLock(req.params.id, req.body, ctx(req))) });
}

async function reiniciar(req, res) {
  res.status(200).json({ mensaje: "Stock y movimientos restaurados a la semilla.", items: await servicio.reiniciar() });
}

module.exports = { listar, obtener, movimientos, crear, ingreso, ajuste, descontar, reponer, estadoLock, descontarSinLock, reiniciar };
