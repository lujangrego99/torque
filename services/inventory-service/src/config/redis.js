const { createClient } = require("redis");
const config = require("./index");
const logger = require("./logger");

let client = null;

function redactarUrl(url) {
  return String(url).replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@");
}

// Se conecta en segundo plano y se reconecta solo. Sin cola offline: si Redis
// está caído, el comando falla enseguida (→ 503) en lugar de quedar esperando.
function conectar() {
  client = createClient({
    url: config.redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 3000,
      reconnectStrategy: (intentos) => Math.min(intentos * 500, 5000),
    },
  });

  let avisado = false;
  client.on("error", (err) => {
    // node-redis emite un error por cada reintento: se loguea una vez por caída.
    if (!avisado) {
      logger.error(`Redis no disponible (${redactarUrl(config.redisUrl)}): ${err.message || err.code}`);
      avisado = true;
    }
  });
  client.on("ready", () => {
    avisado = false;
    logger.info(`Redis conectado en ${redactarUrl(config.redisUrl)}`);
  });

  client.connect().catch(() => {
    // El primer intento fallido ya quedó logueado; reconnectStrategy sigue reintentando.
  });
}

function disponible() {
  return Boolean(client && client.isReady);
}

function getRedis() {
  if (!disponible()) {
    const error = new Error("Redis no está conectado.");
    error.codigo = "redis_down";
    throw error;
  }
  return client;
}

module.exports = { conectar, disponible, getRedis };
