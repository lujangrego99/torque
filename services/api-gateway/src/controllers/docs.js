const config = require("../config");
const { llamar, ServicioNoDisponible } = require("../clients/servicios");

// Swagger agregado: el gateway trae el /api-docs.json de cada servicio (su
// contrato real) y lo publica bajo /api-docs/<servicio>.json. Las rutas de los
// specs son relativas ("/"), así que "Try it out" pasa por el gateway.
async function specDe(req, res) {
  const servicio = config.servicios[req.params.servicio];
  if (!servicio) {
    return res.status(404).json({ error: "Spec no encontrado." });
  }
  try {
    const r = await llamar(servicio.nombre, `${servicio.url.replace(/\/$/, "")}/api-docs.json`, {
      timeoutMs: config.healthTimeoutMs,
      requestId: req.id,
    });
    return res.status(r.status).type("application/json").send(r.contenido);
  } catch (err) {
    if (err instanceof ServicioNoDisponible) {
      return res.status(503).json({ error: "Servicio no disponible.", servicio: err.servicio, causa: err.causa });
    }
    throw err;
  }
}

module.exports = { specDe };
