require("dotenv").config();

// Toda la configuración dependiente del entorno sale de variables de entorno.
// El mismo código corre local (node) y en Docker Compose: solo cambia el .env.
function entero(valor, porDefecto) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

const serviceName = process.env.SERVICE_NAME || "auth-service";

// El secreto de firma no tiene valor por defecto: sin él (o si es corto) el
// servicio no arranca, para que nunca se firme con una clave conocida.
const jwtSecret = process.env.JWT_SECRET || "";
if (jwtSecret.length < 32) {
  console.error(`[${serviceName}] JWT_SECRET falta o tiene menos de 32 caracteres. Ver .env.example.`);
  process.exit(1);
}

module.exports = {
  serviceName,
  port: entero(process.env.PORT, 3004),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/auth",
  mongoRetryMs: entero(process.env.MONGO_RETRY_MS, 3000),
  jwt: {
    secret: jwtSecret,
    // Duración del access token: formato de la librería ("15m", "1h", "30s").
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    issuer: process.env.JWT_ISSUER || "torque-auth",
    audience: process.env.JWT_AUDIENCE || "torque",
  },
  // Costo de bcrypt (2^n iteraciones). 12 ≈ 250 ms por hash en una PC actual.
  bcryptRounds: entero(process.env.BCRYPT_ROUNDS, 12),
  // Administrador inicial: se crea al arrancar si no existe un usuario con ese email.
  admin: {
    email: (process.env.ADMIN_EMAIL || "").trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || "",
    nombre: process.env.ADMIN_NOMBRE || "Administrador",
  },
  logLevel: process.env.LOG_LEVEL || "info",
};
