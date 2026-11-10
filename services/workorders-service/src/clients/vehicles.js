const config = require("../config");
const { crearCliente } = require("./http");

// Interfaz pública de vehicles-service que necesita este servicio.
// Contrato: GET /api/vehiculos/:id            → 200 vehículo | 404 | 401 (requiere token)
//           GET /api/vehiculos/patente/:patente → 200 vehículo | 404
// El vehículo trae `activo`: uno dado de baja no admite órdenes nuevas.
const cliente = crearCliente({
  servicio: "vehicles-service",
  baseUrl: config.vehiclesUrl,
  timeoutMs: config.vehiclesTimeoutMs,
});

function interpretar({ status, body }) {
  if (status === 200) return { encontrado: true, vehiculo: body };
  if (status === 404) return { encontrado: false };
  return { encontrado: false, status, body };
}

async function obtenerVehiculo(id, { requestId, token }) {
  return interpretar(await cliente.request("GET", `/api/vehiculos/${id}`, { requestId, token }));
}

async function obtenerPorPatente(patente, { requestId, token }) {
  return interpretar(await cliente.request("GET", `/api/vehiculos/patente/${encodeURIComponent(patente)}`, { requestId, token }));
}

module.exports = { obtenerVehiculo, obtenerPorPatente };
