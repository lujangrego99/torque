const config = require("../config");
const { llamar, ServicioNoDisponible } = require("../clients/servicios");

// Salud propia del gateway: el proceso está vivo. No depende de los servicios
// internos (si uno cae, el gateway sigue enrutando a los demás).
function propia(req, res) {
  res.status(200).json({ service: config.serviceName, status: "ok" });
}

// Vista agregada: consulta /health de cada servicio interno.
async function servicios(req, res) {
  const entradas = await Promise.all(
    Object.values(config.servicios).map(async (s) => {
      try {
        const r = await llamar(s.nombre, `${s.url.replace(/\/$/, "")}/health`, {
          timeoutMs: config.healthTimeoutMs,
          requestId: req.id,
        });
        let cuerpo = null;
        try {
          cuerpo = JSON.parse(r.contenido.toString("utf8"));
        } catch {
          cuerpo = null;
        }
        return [s.nombre, { httpStatus: r.status, ...(cuerpo || { status: "desconocido" }) }];
      } catch (err) {
        if (err instanceof ServicioNoDisponible) {
          return [s.nombre, { status: "down", causa: err.causa }];
        }
        throw err;
      }
    })
  );
  const detalle = Object.fromEntries(entradas);
  const todosOk = Object.values(detalle).every((d) => d.status === "ok");
  res.status(todosOk ? 200 : 503).json({
    service: config.serviceName,
    status: todosOk ? "ok" : "degraded",
    servicios: detalle,
  });
}

module.exports = { propia, servicios };
