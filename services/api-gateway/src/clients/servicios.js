const logger = require("../config/logger");

// Fallo de comunicación con un servicio interno (no hubo respuesta HTTP).
class ServicioNoDisponible extends Error {
  constructor(servicio, causa, detalle) {
    super(`${servicio}: ${causa}`);
    this.servicio = servicio;
    this.causa = causa; // timeout | dns | conexion_rechazada | red
    this.detalle = detalle;
  }
}

function causaDeRed(err) {
  if (err.name === "TimeoutError" || err.name === "AbortError") return "timeout";
  const codigo = err.cause && err.cause.code;
  if (codigo === "ENOTFOUND" || codigo === "EAI_AGAIN") return "dns";
  if (codigo === "ECONNREFUSED") return "conexion_rechazada";
  return "red";
}

// Cliente HTTP hacia los servicios internos (fetch nativo + timeout).
// Cualquier respuesta HTTP (2xx/4xx/5xx) se devuelve tal cual: el gateway no
// reinterpreta errores de negocio. Solo la falta de respuesta es un fallo propio.
async function llamar(servicio, url, { metodo = "GET", headers = {}, body, timeoutMs, requestId }) {
  try {
    const respuesta = await fetch(url, {
      method: metodo,
      headers: { ...headers, ...(requestId ? { "x-request-id": requestId } : {}) },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const contenido = Buffer.from(await respuesta.arrayBuffer());
    return { status: respuesta.status, headers: respuesta.headers, contenido };
  } catch (err) {
    const causa = causaDeRed(err);
    const detalle = causa === "timeout" ? `sin respuesta en ${timeoutMs} ms` : (err.cause && err.cause.code) || err.message;
    logger.error(`→ ${servicio} ${metodo} ${new URL(url).pathname} falló: ${causa} (${detalle}) rid=${requestId || "-"}`);
    throw new ServicioNoDisponible(servicio, causa, detalle);
  }
}

module.exports = { llamar, ServicioNoDisponible };
