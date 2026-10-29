const mongoose = require("mongoose");
const config = require("./index");
const logger = require("./logger");

// Sin buffer: si Mongo no está, la consulta falla enseguida y la API responde
// 503 en lugar de quedar colgada esperando la conexión.
mongoose.set("bufferCommands", false);
mongoose.set("strictQuery", true);

function redactarUri(uri) {
  return String(uri).replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@");
}

function conectado() {
  return mongoose.connection.readyState === 1;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reintenta hasta conectar. El servidor HTTP ya está escuchando mientras tanto
// (health responde 503), así una base que tarda en iniciar no tumba el proceso.
async function conectarConReintentos() {
  mongoose.connection.on("disconnected", () => logger.warn("MongoDB desconectado."));
  mongoose.connection.on("reconnected", () => logger.info("MongoDB reconectado."));
  mongoose.connection.on("error", (err) => logger.error(`MongoDB: ${err.message}`));

  for (let intento = 1; ; intento += 1) {
    try {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
      logger.info(`MongoDB conectado en ${redactarUri(config.mongoUri)} (db=${mongoose.connection.name})`);
      return;
    } catch (err) {
      logger.warn(
        `MongoDB no disponible (intento ${intento}): ${err.message}. Reintento en ${config.mongoRetryMs} ms.`
      );
      await esperar(config.mongoRetryMs);
    }
  }
}

module.exports = { conectarConReintentos, conectado, redactarUri };
