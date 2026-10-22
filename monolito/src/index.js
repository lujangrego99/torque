require("dotenv").config();

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const app = require("./app");
const logger = require("./logger");
const { conectar: conectarRedis, urlRedis, redactarUrl } = require("./redis");
const { conectar: conectarMongo } = require("./mongo");
const { seedSiVacio } = require("./seed");

const HTTP_PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const ENABLE_HTTP = process.env.ENABLE_HTTP !== "false";

function resolverRuta(valor) {
  if (!valor) {
    return null;
  }
  return path.isAbsolute(valor) ? valor : path.resolve(process.cwd(), valor);
}

function opcionesHttps() {
  const pfxPath = resolverRuta(process.env.SSL_PFX_PATH);
  if (pfxPath) {
    if (!fs.existsSync(pfxPath)) {
      throw new Error(`No se encontró el PFX en ${pfxPath}. Generar el certificado primero.`);
    }
    return {
      pfx: fs.readFileSync(pfxPath),
      passphrase: process.env.SSL_PFX_PASSPHRASE || "",
    };
  }

  const keyPath = resolverRuta(process.env.SSL_KEY_PATH || "./certs/server.key");
  const certPath = resolverRuta(process.env.SSL_CERT_PATH || "./certs/server.crt");

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    throw new Error(
      "No se encontró el certificado HTTPS. En Windows: .\\scripts\\generar-certificado.ps1. En Linux: bash scripts/generar-certificado.sh"
    );
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

async function iniciar() {
  const delay = Number(process.env.DEMO_DELAY_MS) || 0;
  const ttl = Number(process.env.LOCK_TTL_MS) || 8000;
  if (delay > 0 && delay >= ttl) {
    logger.warn(
      `DEMO_DELAY_MS (${delay}) no debería ser mayor o igual que LOCK_TTL_MS (${ttl}): el lock podría vencer antes de terminar la operación.`
    );
  }

  await conectarMongo();
  await seedSiVacio();

  try {
    await conectarRedis();
    logger.info(`Redis/Memurai conectado en ${redactarUrl(urlRedis())}`);
  } catch (err) {
    logger.warn(`No se pudo conectar a Redis (${redactarUrl(urlRedis())}): ${err.message}`);
    logger.warn("HTTPS arranca igual; POST /api/repuestos/:id/descontar responderá 503 hasta que Redis esté disponible.");
  }

  if (ENABLE_HTTP) {
    http.createServer(app).listen(HTTP_PORT, () => {
      logger.info(`HTTP  escuchando en http://localhost:${HTTP_PORT}`);
    });
  }

  const httpsServer = https.createServer(opcionesHttps(), app);
  httpsServer.listen(HTTPS_PORT, () => {
    logger.info(`HTTPS escuchando en https://localhost:${HTTPS_PORT}`);
    logger.info(`Swagger UI en https://localhost:${HTTPS_PORT}/api-docs`);
    logger.info(`Lock TTL=${ttl} ms · delay de demo=${delay} ms · logs=${logger.LOG_DIR}`);
  });
}

iniciar().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
