const config = require("../config");
const { crearCliente } = require("./http");

// Interfaz pública de vehicles-service que necesita este servicio.
// Contrato: GET /api/vehiculos/:id → 200 vehículo | 404 | 401 (requiere token).
const cliente = crearCliente({
  servicio: "vehicles-service",
  baseUrl: config.vehiclesUrl,
  timeoutMs: config.vehiclesTimeoutMs,
});

async function obtenerVehiculo(id, { requestId, token }) {
  const { status, body } = await cliente.request("GET", `/api/vehiculos/${id}`, { requestId, token });
  if (status === 200) return { encontrado: true, vehiculo: body };
  if (status === 404) return { encontrado: false };
  return { encontrado: false, status, body };
}

module.exports = { obtenerVehiculo };
