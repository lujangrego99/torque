const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("../config");
const logger = require("../config/logger");
const Usuario = require("../models/usuario");
const { ErrorHttp, invalido } = require("../utils/errores");
const { parsearObjectId, esObjetoJson } = require("../utils/ids");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// bcrypt solo usa los primeros 72 bytes: se limita para que no haya contraseñas
// distintas que validen igual.
const PASSWORD_MIN = 8;
const PASSWORD_MAX_BYTES = 72;

// Hash con el que se compara cuando el email no existe: el login tarda lo mismo
// exista o no el usuario (no se puede averiguar por tiempo de respuesta).
const HASH_FICTICIO = bcrypt.hashSync("usuario-inexistente", config.bcryptRounds);

// Representación pública: nunca incluye la contraseña ni su hash.
function serializar(doc) {
  return {
    id: String(doc._id),
    email: doc.email,
    nombre: doc.nombre,
    rol: doc.rol,
    activo: doc.activo,
    creadoEn: doc.createdAt,
  };
}

// Para logs: suficiente para diagnosticar sin volcar el email completo.
function enmascarar(email) {
  const [usuario, dominio] = String(email).split("@");
  if (!dominio) return "***";
  return `${usuario.slice(0, 2)}***@${dominio}`;
}

function validarPassword(password, errores) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    errores.push(`password es obligatoria (mínimo ${PASSWORD_MIN} caracteres).`);
  } else if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    errores.push(`password no puede superar ${PASSWORD_MAX_BYTES} bytes.`);
  }
}

// --- Registro (público) -----------------------------------------------------
// Siempre crea un MECANICO: el rol NO lo elige el cliente. Un ADMIN lo puede
// promover después con PATCH /api/auth/usuarios/:id.
async function registrar(body) {
  if (!esObjetoJson(body)) throw invalido(["El body debe ser un objeto JSON."]);
  const errores = [];
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) errores.push("email es obligatorio y debe tener formato válido.");
  const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
  if (nombre.length < 2 || nombre.length > 60) errores.push("nombre es obligatorio (2 a 60 caracteres).");
  validarPassword(body.password, errores);
  if (body.rol !== undefined || body.roles !== undefined) {
    errores.push("El rol no se elige al registrarse: todo usuario nuevo es MECANICO.");
  }
  if (errores.length) throw invalido(errores);

  if (await Usuario.exists({ email })) {
    throw new ErrorHttp(409, "Conflicto de integridad.", ["Ya existe un usuario con ese email."]);
  }
  const passwordHash = await bcrypt.hash(body.password, config.bcryptRounds);
  let doc;
  try {
    doc = await Usuario.create({ email, nombre, passwordHash, rol: "MECANICO" });
  } catch (err) {
    // Carrera entre dos registros iguales: lo resuelve el índice único.
    if (err.code === 11000) throw new ErrorHttp(409, "Conflicto de integridad.", ["Ya existe un usuario con ese email."]);
    throw err;
  }
  logger.info(`Usuario registrado sub=${doc._id} email=${enmascarar(email)} rol=${doc.rol}`);
  return serializar(doc);
}

// --- Login (público) --------------------------------------------------------
// Política de cuenta deshabilitada: 403, pero solo si la contraseña es correcta
// (con una contraseña incorrecta la respuesta es el mismo 401 genérico).
async function login(body, requestId) {
  if (!esObjetoJson(body)) throw invalido(["El body debe ser un objeto JSON."]);
  const errores = [];
  if (typeof body.email !== "string" || !body.email.trim()) errores.push("email es obligatorio.");
  if (typeof body.password !== "string" || !body.password) errores.push("password es obligatoria.");
  if (errores.length) throw invalido(errores);

  const email = body.email.trim().toLowerCase();
  const usuario = await Usuario.findOne({ email }).select("+passwordHash");
  const coincide = await bcrypt.compare(body.password, usuario ? usuario.passwordHash : HASH_FICTICIO);

  if (!usuario || !coincide) {
    // Al cliente, mensaje genérico; en el log, el motivo técnico (sin la contraseña).
    const motivo = usuario ? "password_incorrecta" : "usuario_inexistente";
    logger.warn(`Login fallido email=${enmascarar(email)} motivo=${motivo} rid=${requestId}`);
    throw new ErrorHttp(401, "Credenciales inválidas.");
  }
  if (!usuario.activo) {
    logger.warn(`Login rechazado sub=${usuario._id} motivo=cuenta_deshabilitada rid=${requestId}`);
    throw new ErrorHttp(403, "Cuenta deshabilitada.", ["Pedile a un administrador que la reactive."]);
  }

  // Claims mínimos: identidad (sub) y rol. Nada de email, nombre ni hash.
  const accessToken = jwt.sign({ rol: usuario.rol }, config.jwt.secret, {
    algorithm: "HS256",
    subject: String(usuario._id),
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    expiresIn: config.jwt.expiresIn,
  });
  const { iat, exp } = jwt.decode(accessToken);
  logger.info(`Login OK sub=${usuario._id} rol=${usuario.rol} vence=${new Date(exp * 1000).toISOString()} rid=${requestId}`);
  return {
    accessToken,
    tokenType: "Bearer",
    expiresIn: exp - iat,
    usuario: serializar(usuario),
  };
}

// --- Perfil propio (autenticado) --------------------------------------------
async function perfil(id) {
  const doc = await Usuario.findById(id);
  if (!doc) throw new ErrorHttp(404, "Usuario no encontrado.");
  return serializar(doc);
}

// --- Administración (ADMIN) -------------------------------------------------
async function listar() {
  const docs = await Usuario.find().sort({ createdAt: 1 });
  return docs.map(serializar);
}

async function actualizar(idCrudo, body, admin) {
  const id = parsearObjectId(idCrudo);
  if (id === null) throw invalido(["El id debe ser un ObjectId hexadecimal de 24 caracteres."]);
  if (!esObjetoJson(body)) throw invalido(["El body debe ser un objeto JSON."]);
  const cambios = {};
  const errores = [];
  if (body.rol !== undefined) {
    if (!Usuario.ROLES.includes(body.rol)) errores.push(`rol debe ser uno de: ${Usuario.ROLES.join(", ")}.`);
    else cambios.rol = body.rol;
  }
  if (body.activo !== undefined) {
    if (typeof body.activo !== "boolean") errores.push("activo debe ser true o false.");
    else cambios.activo = body.activo;
  }
  if (!errores.length && Object.keys(cambios).length === 0) errores.push("Indicar rol y/o activo.");
  if (errores.length) throw invalido(errores);
  // Un admin no puede quitarse el rol ni deshabilitarse (evita quedar sin administradores).
  if (id === admin.id && (cambios.rol === "MECANICO" || cambios.activo === false)) {
    throw new ErrorHttp(409, "Operación no permitida.", ["Un administrador no puede quitarse el rol ni deshabilitarse a sí mismo."]);
  }

  const doc = await Usuario.findByIdAndUpdate(id, cambios, { new: true });
  if (!doc) throw new ErrorHttp(404, "Usuario no encontrado.");
  logger.info(`Usuario sub=${doc._id} actualizado por sub=${admin.id}: ${JSON.stringify(cambios)}`);
  return serializar(doc);
}

// --- Administrador inicial --------------------------------------------------
async function crearAdminInicial() {
  const { email, password, nombre } = config.admin;
  if (!email || !password) {
    logger.warn("ADMIN_EMAIL / ADMIN_PASSWORD no definidos: no se crea el administrador inicial.");
    return;
  }
  if (password.length < PASSWORD_MIN) {
    logger.error(`ADMIN_PASSWORD tiene menos de ${PASSWORD_MIN} caracteres: no se crea el administrador inicial.`);
    return;
  }
  if (await Usuario.exists({ email })) {
    logger.info(`Administrador inicial ya existe (${enmascarar(email)}).`);
    return;
  }
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  await Usuario.create({ email, nombre, passwordHash, rol: "ADMIN" });
  logger.info(`Administrador inicial creado (${enmascarar(email)}).`);
}

module.exports = { registrar, login, perfil, listar, actualizar, crearAdminInicial };
