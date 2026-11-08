const config = require("./config");
const logger = require("./config/logger");
const { conectarConReintentos } = require("./config/mongo");
const Usuario = require("./models/usuario");
const Sesion = require("./models/sesion");
const { crearAdminInicial } = require("./services/usuarios");
const app = require("./app");

// Primero se abre el puerto (health responde 503 hasta que haya base) y la
// conexión a Mongo se reintenta en segundo plano.
const server = app.listen(config.port, () => {
  logger.info(
    `Escuchando en el puerto ${config.port} · JWT HS256 iss=${config.jwt.issuer} aud=${config.jwt.audience} vence=${config.jwt.expiresIn} · inactividad=${config.sessionIdleMs / 1000}s · bcrypt=${config.bcryptRounds}`
  );
});

// Con bufferCommands=false Mongoose no puede crear índices antes de conectar:
// se crean acá para que el email único exista (409 por duplicado).
conectarConReintentos()
  .then(() => Promise.all([Usuario.createIndexes(), Sesion.createIndexes()]))
  .then(() => crearAdminInicial())
  .catch((err) => logger.error(`Fallo al inicializar datos: ${err.message}`));

function apagar(senal) {
  logger.info(`${senal} recibido: cerrando el servidor.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("SIGINT", () => apagar("SIGINT"));
