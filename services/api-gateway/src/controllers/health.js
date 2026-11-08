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

// Métricas agregadas: las del gateway y las de cada servicio interno
// (GET /metrics de cada uno). Sirve para ver de un vistazo cuál anda lento o
// falla: se comparan p95, tasa de error y pedidos en curso entre servicios.
async function metricas(req, res) {
  const propias = require("../config/metricas").instantanea(config.serviceName);
  const entradas = await Promise.all(
    Object.values(config.servicios).map(async (s) => {
      try {
        const r = await llamar(s.nombre, `${s.url.replace(/\/$/, "")}/metrics`, {
          timeoutMs: config.healthTimeoutMs,
          requestId: req.id,
        });
        return [s.nombre, JSON.parse(r.contenido.toString("utf8"))];
      } catch (err) {
        if (err instanceof ServicioNoDisponible) return [s.nombre, { status: "down", causa: err.causa }];
        return [s.nombre, { status: "error", causa: err.message }];
      }
    })
  );
  const servicios = Object.fromEntries(entradas);
  // Resumen comparativo: una línea por servicio, ordenado por p95 (el más lento primero).
  const resumen = [[config.serviceName, propias], ...entradas]
    .filter(([, m]) => m.pedidos)
    .map(([nombre, m]) => ({
      servicio: nombre,
      pedidos: m.pedidos.total,
      errores5xx: m.pedidos.errores5xx,
      tasaError5xx: m.pedidos.tasaError5xx,
      p95Ms: m.tiempoRespuestaMs.p95,
      promedioMs: m.tiempoRespuestaMs.promedio,
    }))
    .sort((a, b) => b.p95Ms - a.p95Ms);
  res.json({ generado: new Date().toISOString(), resumen, gateway: propias, servicios });
}

module.exports = { propia, servicios, metricas };
