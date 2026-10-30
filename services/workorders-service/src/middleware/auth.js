const jwt = require("jsonwebtoken");
const config = require("../config");
const logger = require("../config/logger");

// Validación del access token (HS256, emitido por auth-service). Es el mismo
// middleware en cada servicio que protege endpoints: verifica firma, algoritmo,
// emisor, audiencia y vencimiento SIN consultar la base de usuarios.
//
//   sin token / mal formado / firma inválida / vencido → 401
//   token válido → req.usuario = { id, rol } → next()
//   rol insuficiente (autorizar) → 403

const ROLES = ["MECANICO", "ADMIN"];

function rechazar(req, res, codigo, detalle) {
  logger.warn(`${req.method} ${req.originalUrl}: 401 ${codigo} (${detalle}) rid=${req.id || "-"}`);
  res.set("WWW-Authenticate", `Bearer realm="torque", error="${codigo}"`);
  return res.status(401).json({ error: "No autenticado.", detalles: [detalle] });
}

function autenticar(req, res, next) {
  const header = req.get("authorization");
  if (!header) {
    return rechazar(req, res, "invalid_request", "Falta el header Authorization: Bearer <token>.");
  }
  const partes = header.split(" ");
  if (partes.length !== 2 || partes[0] !== "Bearer" || !partes[1]) {
    return rechazar(req, res, "invalid_request", "El header Authorization debe tener el formato: Bearer <token>.");
  }

  let payload;
  try {
    payload = jwt.verify(partes[1], config.jwt.secret, {
      algorithms: ["HS256"], // cualquier otro (incluido "none") se rechaza
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") return rechazar(req, res, "invalid_token", "El token venció.");
    if (err.message === "invalid signature") return rechazar(req, res, "invalid_token", "La firma del token no es válida.");
    if (err.message === "jwt malformed" || err.message === "invalid token") {
      return rechazar(req, res, "invalid_token", "El token está mal formado.");
    }
    return rechazar(req, res, "invalid_token", "El token no es válido.");
  }

  if (typeof payload.sub !== "string" || !ROLES.includes(payload.rol)) {
    return rechazar(req, res, "invalid_token", "El token no tiene una identidad válida.");
  }
  req.usuario = { id: payload.sub, rol: payload.rol };
  // Se conserva para propagarlo a vehicles/inventory (nunca se loguea).
  req.token = partes[1];
  return next();
}

// Autorización por rol. Va siempre después de autenticar.
function autorizar(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.usuario.rol)) return next();
    logger.warn(`${req.method} ${req.originalUrl}: 403 sub=${req.usuario.id} rol=${req.usuario.rol} (requiere ${roles.join("|")}) rid=${req.id || "-"}`);
    return res.status(403).json({
      error: "Permisos insuficientes.",
      detalles: [`Esta operación requiere el rol ${roles.join(" o ")}.`],
    });
  };
}

module.exports = { autenticar, autorizar, ROLES };
