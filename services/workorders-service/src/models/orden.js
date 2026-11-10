const mongoose = require("mongoose");

// Estados de cada repuesto dentro de la orden. Quedan persistidos para poder
// detectar y compensar un fallo parcial (ver docs/tp6/fallo-parcial.md).
//   DESCONTADO   inventory confirmó el descuento
//   RECHAZADO    inventory lo rechazó (sin stock, ocupado, inexistente…)
//   INCIERTO     timeout: pudo haberse aplicado o no (lo resuelve la reposición)
//   NO_INTENTADO no se llegó a pedir porque falló un ítem anterior
//   REPUESTO     el stock descontado volvió al inventario (contramovimiento)
//   NO_APLICADO  era INCIERTO y el libro de movimientos confirmó que no se aplicó
const ESTADOS_ITEM = ["PENDIENTE", "DESCONTADO", "RECHAZADO", "INCIERTO", "NO_INTENTADO", "REPUESTO", "NO_APLICADO"];

// Ciclo de vida (requisito 13):
//   PENDIENTE ──(repuestos descontados)──▶ EN_PROCESO ──(trabajo terminado)──▶ FINALIZADA
//       │                                     │
//       ├──(falla un descuento)──▶ FALLIDA    └──(cancelar)──▶ CANCELADA
//       └──(cancelar)──▶ CANCELADA
// FALLIDA y CANCELADA reponen automáticamente el stock que se haya descontado.
const ESTADOS_ORDEN = ["PENDIENTE", "EN_PROCESO", "FINALIZADA", "CANCELADA", "FALLIDA"];
const ESTADOS_ABIERTOS = ["PENDIENTE", "EN_PROCESO"];

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

const transicionSchema = new mongoose.Schema(
  { estado: { type: String, enum: ESTADOS_ORDEN }, fecha: Date, por: String, detalle: String },
  { _id: false }
);

const ordenSchema = new mongoose.Schema(
  {
    // Referencia lógica a vehicles-service + copia de la patente al momento de la orden.
    vehiculoId: { type: String, required: true, index: true },
    patente: { type: String, index: true },
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
    // Cada cambio de estado: cuándo, quién (sub) y por qué. Es la auditoría de la orden.
    historial: { type: [transicionSchema], default: [] },
    // Se completa si la orden falla: en qué etapa, por qué y si quedó stock descontado.
    falla: {
      etapa: String,
      servicio: String,
      causa: String,
      detalle: String,
    },
    // Cancelación (requisito 14): motivo, quién y cuándo.
    cancelacion: {
      motivo: String,
      por: String,
      rol: String,
      fecha: Date,
    },
    finalizacion: {
      por: String,
      fecha: Date,
    },
    // Reposición del stock descontado (requisito 10). PENDIENTE = inventory no
    // estaba disponible: se reintenta con POST /api/ordenes/:id/reponer.
    reposicion: {
      estado: { type: String, enum: ["NO_REQUERIDA", "COMPLETA", "PENDIENTE"] },
      unidades: Number,
      fecha: Date,
      detalle: String,
      intentos: Number,
    },
    // true mientras haya stock descontado (o incierto) que todavía no volvió al inventario.
    requiereCompensacion: { type: Boolean, default: false },
  },
  { versionKey: false, timestamps: true }
);

module.exports = mongoose.model("OrdenTrabajo", ordenSchema, "ordenes");
module.exports.ESTADOS_ITEM = ESTADOS_ITEM;
module.exports.ESTADOS_ORDEN = ESTADOS_ORDEN;
module.exports.ESTADOS_ABIERTOS = ESTADOS_ABIERTOS;
