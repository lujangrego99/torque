const { randomBytes, createHash } = require("crypto");
const config = require("../config");
const logger = require("../config/logger");
const Sesion = require("../models/sesion");
const { ErrorHttp } = require("../utils/errores");

// Estado de las renovaciones (ver models/sesion.js). El refresh token es un
// valor aleatorio opaco (no un JWT): solo sirve contra auth-service, y en la
// base se guarda su hash, así una copia de la base no permite renovar nada.

const hash = (token) => createHash("sha256").update(token).digest("hex");
const nuevoToken = () => randomBytes(32).toString("base64url");

function respuesta(sesion, refreshToken) {
  return {
    refreshToken,
    // Plazo de inactividad: si no se renueva antes de esta fecha, la sesión vence.
    refreshExpiresIn: Math.round(config.sessionIdleMs / 1000),
    sesionVenceSinUsoEn: sesion.expiraEn.toISOString(),
  };
}

function rechazo(detalle) {
  return new ErrorHttp(401, "Sesión no válida.", [detalle]);
}

async function abrir(usuario) {
  const refreshToken = nuevoToken();
  const ahora = new Date();
  const sesion = await Sesion.create({
    usuarioId: String(usuario._id),
    tokenHash: hash(refreshToken),
    ultimoUso: ahora,
    expiraEn: new Date(ahora.getTime() + config.sessionIdleMs),
  });
  return { id: String(sesion._id), respuesta: respuesta(sesion, refreshToken) };
}

// Valida el refresh token y lo rota. Casos:
//  - vigente → token nuevo, se corre el plazo de inactividad;
//  - revocada (logout / usuario deshabilitado) → 401;
//  - vencida por inactividad → 401 (se marca revocada);
//  - token ya rotado (reutilización) → se revoca la sesión entera y 401.
async function rotar(refreshToken, requestId) {
  const h = hash(refreshToken);
  const sesion = await Sesion.findOne({ tokenHash: h });
  if (!sesion) {
    const robada = await Sesion.findOne({ anteriores: h });
    if (robada && !robada.revocadaEn) {
      await revocar(robada._id, "reutilizacion_refresh_token");
      logger.warn(`Refresh token reutilizado: sesion=${robada._id} sub=${robada.usuarioId} revocada rid=${requestId}`);
      throw rechazo("El refresh token ya fue usado. Por seguridad se cerró la sesión: volver a iniciar sesión.");
    }
    throw rechazo("Refresh token inválido.");
  }
  if (sesion.revocadaEn) throw rechazo("La sesión fue cerrada.");
  const ahora = new Date();
  if (sesion.expiraEn <= ahora) {
    await revocar(sesion._id, "inactividad");
    logger.info(`Sesión vencida por inactividad sesion=${sesion._id} sub=${sesion.usuarioId} (último uso ${sesion.ultimoUso.toISOString()}) rid=${requestId}`);
    throw rechazo("La sesión venció por inactividad. Volver a iniciar sesión.");
  }

  const refreshNuevo = nuevoToken();
  // Rotación atómica: solo gana una renovación con el mismo token (si dos llegan
  // juntas, la segunda ya no encuentra el hash vigente).
  const rotada = await Sesion.findOneAndUpdate(
    { _id: sesion._id, tokenHash: h, revocadaEn: { $exists: false } },
    {
      $set: { tokenHash: hash(refreshNuevo), ultimoUso: ahora, expiraEn: new Date(ahora.getTime() + config.sessionIdleMs) },
      $push: { anteriores: { $each: [h], $slice: -20 } },
      $inc: { renovaciones: 1 },
    },
    { new: true }
  );
  if (!rotada) throw rechazo("Refresh token inválido.");
  return { id: String(rotada._id), usuarioId: rotada.usuarioId, renovaciones: rotada.renovaciones, respuesta: respuesta(rotada, refreshNuevo) };
}

async function revocar(id, motivo) {
  await Sesion.updateOne({ _id: id, revocadaEn: { $exists: false } }, { $set: { revocadaEn: new Date(), motivoRevocacion: motivo } });
}

async function revocarPorToken(refreshToken, motivo) {
  const sesion = await Sesion.findOneAndUpdate(
    { tokenHash: hash(refreshToken), revocadaEn: { $exists: false } },
    { $set: { revocadaEn: new Date(), motivoRevocacion: motivo } }
  );
  return sesion ? String(sesion._id) : null;
}

async function revocarDeUsuario(usuarioId, motivo) {
  const r = await Sesion.updateMany(
    { usuarioId: String(usuarioId), revocadaEn: { $exists: false } },
    { $set: { revocadaEn: new Date(), motivoRevocacion: motivo } }
  );
  if (r.modifiedCount) logger.info(`Sesiones revocadas sub=${usuarioId}: ${r.modifiedCount} (${motivo})`);
}

module.exports = { abrir, rotar, revocar, revocarPorToken, revocarDeUsuario };
