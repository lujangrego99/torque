require("dotenv").config();

// Toda la configuración dependiente del entorno sale de variables de entorno.
// El mismo código corre local (node) y en Docker Compose: solo cambia el .env.
function entero(valor, porDefecto) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

const serviceName = process.env.SERVICE_NAME || "inventory-service";

// Clave para VERIFICAR los access tokens (HS256) que emite auth-service. Es el
// mismo secreto que usa auth-service para firmar; sin él el servicio no arranca.
const jwtSecret = process.env.JWT_SECRET || "";
if (jwtSecret.length < 32) {
  console.error(`[${serviceName}] JWT_SECRET falta o tiene menos de 32 caracteres. Ver .env.example.`);
  process.exit(1);
}

module.exports = {
  serviceName,
  port: entero(process.env.PORT, 3002),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/inventory",
  mongoRetryMs: entero(process.env.MONGO_RETRY_MS, 3000),
  // Redis (Linux/Docker) o Memurai (Windows): coordinador del lock de stock.
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  // TTL del lock. Tiene que ser mayor que DEMO_DELAY_MS.
  lockTtlMs: entero(process.env.LOCK_TTL_MS, 8000),
  // Retardo artificial dentro de la sección crítica para ver la carrera (TP2).
  demoDelayMs: entero(process.env.DEMO_DELAY_MS, 0),
  seedOnStart: process.env.SEED_ON_START !== "false",
  jwt: {
    secret: jwtSecret,
    issuer: process.env.JWT_ISSUER || "torque-auth",
    audience: process.env.JWT_AUDIENCE || "torque",
  },
  logLevel: process.env.LOG_LEVEL || "info",
};
