require("dotenv").config();

// Toda la configuración dependiente del entorno sale de variables de entorno.
// El mismo código corre local (node) y en Docker Compose: solo cambia el .env.
function entero(valor, porDefecto) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

module.exports = {
  serviceName: process.env.SERVICE_NAME || "workorders-service",
  port: entero(process.env.PORT, 3003),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/workorders",
  mongoRetryMs: entero(process.env.MONGO_RETRY_MS, 3000),
  // Ubicación de los servicios remotos: siempre por variable de entorno.
  vehiclesUrl: process.env.VEHICLES_SERVICE_URL || "http://localhost:3001",
  inventoryUrl: process.env.INVENTORY_SERVICE_URL || "http://localhost:3002",
  vehiclesTimeoutMs: entero(process.env.VEHICLES_TIMEOUT_MS, 2000),
  inventoryTimeoutMs: entero(process.env.INVENTORY_TIMEOUT_MS, 5000),
  logLevel: process.env.LOG_LEVEL || "info",
};
