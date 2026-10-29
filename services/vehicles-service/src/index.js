const config = require("./config");
const logger = require("./config/logger");
const { conectarConReintentos } = require("./config/mongo");
const { seedSiVacio } = require("./models/seed");
const Vehiculo = require("./models/vehiculo");
const app = require("./app");

// Primero se abre el puerto (health responde 503 hasta que haya base) y la
// conexión a Mongo se reintenta en segundo plano.
const server = app.listen(config.port, () => {
  logger.info(`Escuchando en el puerto ${config.port} · Swagger en /api-docs · salud en /health`);
});

// Con bufferCommands=false Mongoose no puede crear índices antes de conectar:
// se crean acá para que el índice único de patente exista (409 por duplicado).
conectarConReintentos()
  .then(() => Vehiculo.createIndexes())
  .then(() => (config.seedOnStart ? seedSiVacio() : null))
  .catch((err) => logger.error(`Fallo al inicializar datos: ${err.message}`));

function apagar(senal) {
  logger.info(`${senal} recibido: cerrando el servidor.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("SIGINT", () => apagar("SIGINT"));
