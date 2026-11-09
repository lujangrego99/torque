const config = require("./config");
const logger = require("./config/logger");
const { conectarConReintentos } = require("./config/mongo");
const redis = require("./config/redis");
const { seedSiVacio } = require("./models/seed");
const Repuesto = require("./models/repuesto");
const Movimiento = require("./models/movimiento");
const app = require("./app");

if (config.demoDelayMs > 0 && config.demoDelayMs >= config.lockTtlMs) {
  logger.warn(
    `DEMO_DELAY_MS (${config.demoDelayMs}) >= LOCK_TTL_MS (${config.lockTtlMs}): el lock podría vencer dentro de la sección crítica.`
  );
}

// Primero se abre el puerto (health responde 503 hasta que haya base); Mongo
// y Redis se conectan en segundo plano con reintentos.
const server = app.listen(config.port, () => {
  logger.info(
    `Escuchando en el puerto ${config.port} · Swagger en /api-docs · salud en /health · lock TTL=${config.lockTtlMs} ms · delay demo=${config.demoDelayMs} ms · laboratorio=${config.labEndpoints ? "ACTIVO" : "apagado"}`
  );
});

redis.conectar();

// Con bufferCommands=false los índices (codigo único) se crean después de conectar.
conectarConReintentos()
  .then(() => Promise.all([Repuesto.createIndexes(), Movimiento.createIndexes()]))
  .then(() => (config.seedOnStart ? seedSiVacio() : null))
  .catch((err) => logger.error(`Fallo al inicializar datos: ${err.message}`));

function apagar(senal) {
  logger.info(`${senal} recibido: cerrando el servidor.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("SIGINT", () => apagar("SIGINT"));
