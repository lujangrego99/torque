require("dotenv").config();

// Toda la configuración dependiente del entorno sale de variables de entorno.
// El mismo código corre local (node) y en Docker Compose: solo cambia el .env.
function entero(valor, porDefecto) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

module.exports = {
  serviceName: process.env.SERVICE_NAME || "api-gateway",
  port: entero(process.env.PORT, 3000),
  httpsPort: entero(process.env.HTTPS_PORT, 3443),
  sslKeyPath: process.env.SSL_KEY_PATH || "./certs/server.key",
  sslCertPath: process.env.SSL_CERT_PATH || "./certs/server.crt",
  // Tabla de servicios internos. El gateway no tiene reglas de negocio: solo
  // sabe qué prefijo público le pertenece a qué servicio.
  servicios: {
    vehicles: { nombre: "vehicles-service", url: process.env.VEHICLES_SERVICE_URL || "http://localhost:3001" },
    inventory: { nombre: "inventory-service", url: process.env.INVENTORY_SERVICE_URL || "http://localhost:3002" },
    workorders: { nombre: "workorders-service", url: process.env.WORKORDERS_SERVICE_URL || "http://localhost:3003" },
    auth: { nombre: "auth-service", url: process.env.AUTH_SERVICE_URL || "http://localhost:3004" },
  },
  proxyTimeoutMs: entero(process.env.PROXY_TIMEOUT_MS, 15000),
  healthTimeoutMs: entero(process.env.HEALTH_TIMEOUT_MS, 2000),
  logLevel: process.env.LOG_LEVEL || "info",
};
