const config = require("../config");
const { crearCliente } = require("./http");

// Interfaz pública de inventory-service que necesita este servicio.
// Contrato:
//   GET  /api/repuestos/:id            → 200 repuesto | 404
//   POST /api/repuestos/:id/descontar  → 200 descontado | 404 | 409 (sin stock / ocupado) | 503
const cliente = crearCliente({
  servicio: "inventory-service",
  baseUrl: config.inventoryUrl,
  timeoutMs: config.inventoryTimeoutMs,
});

async function obtenerRepuesto(id, requestId) {
  const { status, body } = await cliente.request("GET", `/api/repuestos/${id}`, { requestId });
  if (status === 200) return { encontrado: true, repuesto: body };
  return { encontrado: false, status, body };
}

// Usa el camino seguro (con lock Redis). La regla de stock vive solo en
// inventory-service: acá no se compara stock, se interpreta su respuesta.
async function descontar(id, cantidad, requestId) {
  const { status, body } = await cliente.request("POST", `/api/repuestos/${id}/descontar`, {
    body: { cantidad },
    requestId,
  });
  return { ok: status === 200, status, body };
}

module.exports = { obtenerRepuesto, descontar };
