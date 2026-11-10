const mongoose = require("mongoose");

// Libro de movimientos de stock (requisito 9). Cada cambio de stock deja una
// línea: no se edita ni se borra. El stock de un repuesto es la suma de sus
// movimientos (el campo `stock` del repuesto es el saldo, para leerlo rápido).
//
//   INGRESO     +n   llega mercadería (ADMIN)
//   AJUSTE      ±n   corrección de un error de conteo, con motivo (ADMIN)
//   DESCUENTO   -n   una orden de trabajo consume repuestos (ordenId obligatorio)
//   REPOSICION  +n   se devuelve lo que descontó una orden cancelada o fallida
//                    (contramovimiento ligado a la misma orden, no un rollback)
const TIPOS = ["INGRESO", "AJUSTE", "DESCUENTO", "REPOSICION"];

const movimientoSchema = new mongoose.Schema(
  {
    repuestoId: { type: String, required: true, index: true },
    codigo: { type: String, required: true },
    tipo: { type: String, enum: TIPOS, required: true },
    // Variación del stock con signo (+ suma, - resta). Una REPOSICION con 0
    // indica "la orden ya se cerró y no había nada que devolver" (bloquea un
    // descuento tardío de esa orden, ver services/repuestos.js).
    cantidad: { type: Number, required: true },
    stockAnterior: { type: Number, required: true },
    stockResultante: { type: Number, required: true },
    // sub del token de quien hizo la operación ("sistema" para la semilla).
    usuario: { type: String, required: true },
    rol: String,
    // Orden de trabajo asociada (referencia lógica a workorders-service).
    ordenId: { type: String, index: true },
    motivo: String,
    requestId: String,
  },
  { versionKey: false, timestamps: { createdAt: "fecha", updatedAt: false } }
);

// Una orden descuenta y repone cada repuesto UNA sola vez. El índice único hace
// idempotentes los reintentos (p. ej. después de un timeout) y es la base de la
// reposición exacta: se devuelve lo que dice el libro, no lo que cree la orden.
movimientoSchema.index(
  { ordenId: 1, repuestoId: 1, tipo: 1 },
  { unique: true, partialFilterExpression: { ordenId: { $exists: true }, tipo: { $in: ["DESCUENTO", "REPOSICION"] } } }
);
movimientoSchema.index({ fecha: -1 });

module.exports = mongoose.model("Movimiento", movimientoSchema, "movimientos");
module.exports.TIPOS = TIPOS;
