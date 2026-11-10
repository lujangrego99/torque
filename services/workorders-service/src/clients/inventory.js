const config = require("../config");
const { crearCliente } = require("./http");

// Interfaz pública de inventory-service que necesita este servicio. Todo
// requiere token: se propaga el del usuario que opera.
// Contrato:
//   GET  /api/repuestos/:id            → 200 repuesto | 404
//   POST /api/repuestos/:id/descontar  → 200 descontado | 404 | 409 (sin stock / ocupado / orden cerrada) | 401/403 | 503
//   POST /api/repuestos/reposiciones   → 200 { items[] } | 403 | 503   (idempotente)
const cliente = crearCliente({
  servicio: "inventory-service",
  baseUrl: config.inventoryUrl,
  timeoutMs: config.inventoryTimeoutMs,
});

async function obtenerRepuesto(id, { requestId, token }) {
  const { status, body } = await cliente.request("GET", `/api/repuestos/${id}`, { requestId, token });
  if (status === 200) return { encontrado: true, repuesto: body };
  return { encontrado: false, status, body };
}

// Usa el camino seguro (con lock Redis). La regla de stock vive solo en
// inventory-service: acá no se compara stock, se interpreta su respuesta.
// El ordenId liga el descuento a la orden en el libro de movimientos.
async function descontar(id, cantidad, ordenId, { requestId, token }) {
  const { status, body } = await cliente.request("POST", `/api/repuestos/${id}/descontar`, {
    body: { cantidad, ordenId },
    requestId,
    token,
  });
  return { ok: status === 200, status, body };
}

// Contramovimiento: inventory devuelve lo que su libro registra para la orden.
async function reponer(ordenId, repuestoIds, motivo, { requestId, token }) {
  const { status, body } = await cliente.request("POST", "/api/repuestos/reposiciones", {
    body: { ordenId, repuestoIds, motivo },
    requestId,
    token,
  });
  return { ok: status === 200, status, body };
}

module.exports = { obtenerRepuesto, descontar, reponer };
