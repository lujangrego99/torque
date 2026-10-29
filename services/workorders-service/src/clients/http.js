const logger = require("../config/logger");

// Fallo de infraestructura al hablar con otro servicio: no hubo una respuesta
// HTTP válida (timeout, DNS, conexión rechazada) o el remoto devolvió 5xx.
// `causa` le permite a la capa de negocio decidir (503, 502, estado incierto…).
class ErrorDependencia extends Error {
  constructor(servicio, causa, detalle, statusRemoto) {
    super(`${servicio}: ${causa}${detalle ? ` (${detalle})` : ""}`);
    this.servicio = servicio;
    this.causa = causa; // timeout | dns | conexion_rechazada | red | error_remoto | no_disponible
    this.detalle = detalle;
    this.statusRemoto = statusRemoto;
  }
}

function causaDeRed(err) {
  if (err.name === "TimeoutError" || err.name === "AbortError") return "timeout";
  const codigo = err.cause && err.cause.code;
  if (codigo === "ENOTFOUND" || codigo === "EAI_AGAIN") return "dns";
  if (codigo === "ECONNREFUSED") return "conexion_rechazada";
  return "red";
}

// Cliente HTTP mínimo sobre fetch nativo (Node ≥ 18). Encapsula URL base,
// timeout, propagación del request id y clasificación de errores, para que
// ni los controladores ni los servicios conozcan esos detalles.
//
// - Respuesta 2xx/4xx  → { status, body }  (los 4xx son errores funcionales: decide el negocio)
// - Respuesta 503      → ErrorDependencia(no_disponible)  (el remoto avisa que no puede atender)
// - Otra 5xx           → ErrorDependencia(error_remoto)
// - Sin respuesta      → ErrorDependencia(timeout | dns | conexion_rechazada | red)
function crearCliente({ servicio, baseUrl, timeoutMs }) {
  async function request(metodo, ruta, { body, requestId } = {}) {
    const url = `${baseUrl.replace(/\/$/, "")}${ruta}`;
    const inicio = Date.now();
    let respuesta;

    try {
      respuesta = await fetch(url, {
        method: metodo,
        headers: {
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(requestId ? { "x-request-id": requestId } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const causa = causaDeRed(err);
      const detalle = causa === "timeout" ? `sin respuesta en ${timeoutMs} ms` : (err.cause && err.cause.code) || err.message;
      logger.error(`→ ${servicio} ${metodo} ${ruta} falló: ${causa} (${detalle}) rid=${requestId || "-"}`);
      throw new ErrorDependencia(servicio, causa, detalle);
    }

    const texto = await respuesta.text();
    let datos = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      datos = { texto };
    }

    const linea = `→ ${servicio} ${metodo} ${ruta} ${respuesta.status} ${Date.now() - inicio}ms rid=${requestId || "-"}`;
    if (respuesta.status >= 500) {
      logger.error(linea);
      const detalle = (datos && (datos.detalles || [datos.error]).filter(Boolean).join("; ")) || `HTTP ${respuesta.status}`;
      const causa = respuesta.status === 503 ? "no_disponible" : "error_remoto";
      throw new ErrorDependencia(servicio, causa, detalle, respuesta.status);
    }
    if (respuesta.status >= 400) logger.warn(linea);
    else logger.debug(linea);

    return { status: respuesta.status, body: datos };
  }

  return { request, servicio };
}

module.exports = { crearCliente, ErrorDependencia };
