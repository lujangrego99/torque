const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const config = require("./config");
const logger = require("./config/logger");
const app = require("./app");

const servidores = [];

servidores.push(
  http.createServer(app).listen(config.port, () => {
    logger.info(`HTTP  escuchando en el puerto ${config.port} · Swagger en /api-docs`);
    for (const s of Object.values(config.servicios)) {
      logger.info(`Ruta interna ${s.nombre} → ${s.url}`);
    }
  })
);

// HTTPS (TP2) solo para el acceso externo. Entre contenedores se usa HTTP
// (simplificación permitida por el TP6). Sin certificado, arranca solo HTTP.
const key = path.resolve(process.cwd(), config.sslKeyPath);
const cert = path.resolve(process.cwd(), config.sslCertPath);
if (fs.existsSync(key) && fs.existsSync(cert)) {
  servidores.push(
    https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, app).listen(config.httpsPort, () => {
      logger.info(`HTTPS escuchando en el puerto ${config.httpsPort} (certificado autofirmado)`);
    })
  );
} else {
  logger.warn("Sin certificado en certs/: HTTPS deshabilitado. Generar con `bash scripts/generar-certificado.sh`.");
}

function apagar(senal) {
  logger.info(`${senal} recibido: cerrando el gateway.`);
  let pendientes = servidores.length;
  servidores.forEach((s) =>
    s.close(() => {
      pendientes -= 1;
      if (pendientes === 0) process.exit(0);
    })
  );
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("SIGINT", () => apagar("SIGINT"));
