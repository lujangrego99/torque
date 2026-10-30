require("dotenv").config();

// Toda la configuración dependiente del entorno sale de variables de entorno.
// El mismo código corre local (node) y en Docker Compose: solo cambia el .env.
function entero(valor, porDefecto) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

const serviceName = process.env.SERVICE_NAME || "vehicles-service";

// Clave para VERIFICAR los access tokens (HS256) que emite auth-service. Es el
// mismo secreto que usa auth-service para firmar; sin él el servicio no arranca.
const jwtSecret = process.env.JWT_SECRET || "";
if (jwtSecret.length < 32) {
  console.error(`[${serviceName}] JWT_SECRET falta o tiene menos de 32 caracteres. Ver .env.example.`);
  process.exit(1);
}

module.exports = {
  serviceName,
  port: entero(process.env.PORT, 3001),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/vehicles",
  mongoRetryMs: entero(process.env.MONGO_RETRY_MS, 3000),
  seedOnStart: process.env.SEED_ON_START !== "false",
  jwt: {
    secret: jwtSecret,
    issuer: process.env.JWT_ISSUER || "torque-auth",
    audience: process.env.JWT_AUDIENCE || "torque",
  },
  logLevel: process.env.LOG_LEVEL || "info",
};
