require("dotenv").config();

// Toda la configuración dependiente del entorno sale de variables de entorno.
// El mismo código corre local (node) y en Docker Compose: solo cambia el .env.
function entero(valor, porDefecto) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

module.exports = {
  serviceName: process.env.SERVICE_NAME || "vehicles-service",
  port: entero(process.env.PORT, 3001),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/vehicles",
  mongoRetryMs: entero(process.env.MONGO_RETRY_MS, 3000),
  seedOnStart: process.env.SEED_ON_START !== "false",
  logLevel: process.env.LOG_LEVEL || "info",
};
