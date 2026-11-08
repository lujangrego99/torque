const mongoose = require("mongoose");

// Sesión renovable (requisito 3). El access token (JWT, 5 min) no se guarda: lo
// verifica cada servicio solo con la firma. Lo que se guarda es el estado de la
// RENOVACIÓN: el refresh token vigente (solo su hash SHA-256, nunca el valor),
// cuándo se usó por última vez y si la sesión fue cerrada.
//
// - Cada /refresh rota el refresh token: el anterior deja de servir.
// - Si pasan SESSION_IDLE (15 min) sin renovar, la sesión vence por inactividad.
// - /logout (o deshabilitar al usuario) revoca la sesión: no se renueva más.
// - Si alguien presenta un refresh token YA rotado (posible robo), se revoca la
//   sesión entera: el ladrón y el usuario legítimo tienen que volver a loguearse.
const sesionSchema = new mongoose.Schema(
  {
    usuarioId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    anteriores: { type: [String], default: [], index: true },
    ultimoUso: { type: Date, required: true },
    expiraEn: { type: Date, required: true },
    renovaciones: { type: Number, default: 0 },
    revocadaEn: Date,
    motivoRevocacion: String,
  },
  { versionKey: false, timestamps: true }
);

// Limpieza automática: Mongo borra la sesión un día después de vencida.
sesionSchema.index({ expiraEn: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model("Sesion", sesionSchema, "sesiones");
