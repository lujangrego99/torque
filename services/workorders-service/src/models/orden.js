const mongoose = require("mongoose");

// Estados de cada repuesto dentro de la orden. Quedan persistidos para poder
// detectar y compensar un fallo parcial (ver docs/tp6/fallo-parcial.md).
const ESTADOS_ITEM = ["PENDIENTE", "DESCONTADO", "RECHAZADO", "INCIERTO", "NO_INTENTADO"];
const ESTADOS_ORDEN = ["PENDIENTE", "CONFIRMADA", "FALLIDA"];

const itemSchema = new mongoose.Schema(
  {
    // Referencia lógica a un repuesto de inventory-service (no hay join ni acceso a su base).
    repuestoId: { type: String, required: true },
    codigo: String,
    nombre: String,
    cantidad: { type: Number, required: true, min: 1 },
    estado: { type: String, enum: ESTADOS_ITEM, default: "PENDIENTE" },
    detalle: String,
  },
  { _id: false }
);

const ordenSchema = new mongoose.Schema(
  {
    // Referencia lógica a vehicles-service + copia de la patente al momento de la orden.
    vehiculoId: { type: String, required: true, index: true },
    patente: String,
    // Identidad que creó la orden (sub del JWT, emitido por auth-service). Es una
    // referencia lógica: este servicio no conoce la base de usuarios.
    creadaPor: { type: String, index: true },
    descripcion: {
      type: String,
      required: [true, "El campo descripcion es obligatorio."],
      trim: true,
      minlength: [3, "La descripcion debe tener al menos 3 caracteres."],
      maxlength: [200, "La descripcion no puede superar 200 caracteres."],
    },
    estado: { type: String, enum: ESTADOS_ORDEN, default: "PENDIENTE", index: true },
    items: { type: [itemSchema], default: [] },
    // Se completa si la orden falla: en qué etapa, por qué y si quedó stock descontado.
    falla: {
      etapa: String,
      servicio: String,
      causa: String,
      detalle: String,
    },
    requiereCompensacion: { type: Boolean, default: false },
  },
  { versionKey: false, timestamps: true }
);

module.exports = mongoose.model("OrdenTrabajo", ordenSchema, "ordenes");
module.exports.ESTADOS_ITEM = ESTADOS_ITEM;
module.exports.ESTADOS_ORDEN = ESTADOS_ORDEN;
