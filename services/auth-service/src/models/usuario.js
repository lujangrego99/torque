const mongoose = require("mongoose");

// Roles del taller. MECANICO: opera vehículos, stock y sus propias órdenes.
// ADMIN: jefe de taller (todo lo anterior + bajas, diagnóstico y usuarios).
const ROLES = ["MECANICO", "ADMIN"];

const usuarioSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    nombre: { type: String, required: true, trim: true },
    // Hash bcrypt (incluye el salt). Nunca la contraseña original. `select: false`
    // evita que salga en una consulta común: solo el login lo pide explícitamente.
    passwordHash: { type: String, required: true, select: false },
    rol: { type: String, enum: ROLES, default: "MECANICO" },
    // Deshabilitar sin borrar: conserva el historial (órdenes creadas, etc.).
    activo: { type: Boolean, default: true },
  },
  { versionKey: false, timestamps: true }
);

module.exports = mongoose.model("Usuario", usuarioSchema, "usuarios");
module.exports.ROLES = ROLES;
