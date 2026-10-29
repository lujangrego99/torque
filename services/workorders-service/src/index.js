const config = require("./config");
const logger = require("./config/logger");
const { conectarConReintentos } = require("./config/mongo");
const Orden = require("./models/orden");
const app = require("./app");

const server = app.listen(config.port, () => {
  logger.info(
    `Escuchando en el puerto ${config.port} · Swagger en /api-docs · salud en /health · vehicles=${config.vehiclesUrl} (${config.vehiclesTimeoutMs} ms) · inventory=${config.inventoryUrl} (${config.inventoryTimeoutMs} ms)`
  );
});

// Sin seed: las órdenes se crean durante las pruebas. Los índices se crean
// después de conectar (bufferCommands=false).
conectarConReintentos()
  .then(() => Orden.createIndexes())
  .catch((err) => logger.error(`Fallo al inicializar la base: ${err.message}`));

function apagar(senal) {
  logger.info(`${senal} recibido: cerrando el servidor.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("SIGINT", () => apagar("SIGINT"));
