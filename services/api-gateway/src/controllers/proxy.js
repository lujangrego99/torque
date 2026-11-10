const config = require("../config");
const { llamar, ServicioNoDisponible } = require("../clients/servicios");
const { resolver } = require("../services/rutas");

// Headers que se reenvían al servicio interno y de vuelta al cliente.
// Authorization pasa sin tocar: el gateway NO valida el JWT, lo valida cada
// servicio dueño (así ninguno confía en que "alguien antes ya lo revisó").
const HEADERS_IDA = ["content-type", "accept", "authorization"];
const HEADERS_VUELTA = ["content-type", "location", "www-authenticate"];

// Reenvía la request al servicio dueño del prefijo y devuelve su respuesta sin
// modificarla (status y cuerpo, incluidos 4xx/5xx funcionales del servicio).
// Si el servicio no responde → 503 propio del gateway, con la causa.
async function reenviar(req, res, next) {
  const destino = resolver(req.baseUrl + req.path);
  if (!destino) return next();

  const { servicio } = destino;
  // Métrica por prefijo público + método (no por URL: los ids no abren entradas nuevas).
  res.locals.rutaMetrica = `${req.method} ${destino.prefijo} → ${servicio.nombre}`;
  const headers = {};
  for (const h of HEADERS_IDA) {
    if (req.get(h)) headers[h] = req.get(h);
  }
  headers["x-forwarded-proto"] = req.protocol;
  headers["x-forwarded-for"] = req.ip;

  const tieneBody = !["GET", "HEAD"].includes(req.method) && Buffer.isBuffer(req.body) && req.body.length > 0;

  try {
    const r = await llamar(servicio.nombre, `${servicio.url.replace(/\/$/, "")}${req.originalUrl}`, {
      metodo: req.method,
      headers,
      body: tieneBody ? req.body : undefined,
      timeoutMs: config.proxyTimeoutMs,
      requestId: req.id,
    });
    for (const h of HEADERS_VUELTA) {
      if (r.headers.get(h)) res.set(h, r.headers.get(h));
    }
    res.locals.destino = servicio.nombre;
    return res.status(r.status).send(r.contenido.length ? r.contenido : undefined);
  } catch (err) {
    if (err instanceof ServicioNoDisponible) {
      res.locals.destino = servicio.nombre;
      return res.status(503).json({
        error: "Servicio no disponible.",
        servicio: err.servicio,
        causa: err.causa,
        detalles: [`${err.servicio} no respondió (${err.causa}${err.detalle ? `: ${err.detalle}` : ""}). Reintentar más tarde.`],
      });
    }
    return next(err);
  }
}

module.exports = { reenviar };
