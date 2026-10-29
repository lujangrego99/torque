const express = require("express");
const { randomUUID } = require("crypto");
const config = require("./config");
const logger = require("./config/logger");
const rutas = require("./routes");

const app = express();
app.set("trust proxy", true);

// El cuerpo se reenvía crudo: el JSON lo valida el servicio dueño.
app.use("/api", express.raw({ type: () => true, limit: "1mb" }));

// Request id: se genera acá y viaja a todos los servicios (x-request-id), así
// una operación se sigue en `docker compose logs` de punta a punta.
app.use((req, res, next) => {
  const inicio = Date.now();
  req.id = req.get("x-request-id") || randomUUID();
  res.set("x-request-id", req.id);
  res.on("finish", () => {
    const destino = res.locals.destino ? ` → ${res.locals.destino}` : "";
    const linea = `${req.protocol.toUpperCase()} ${req.method} ${req.originalUrl}${destino} ${res.statusCode} ${Date.now() - inicio}ms rid=${req.id}`;
    if (res.statusCode >= 500) logger.error(linea);
    else if (res.statusCode >= 400) logger.warn(linea);
    else if (req.path !== "/health") logger.info(linea);
  });
  next();
});

app.get("/", (req, res) => {
  res.json({
    mensaje: "torque — api-gateway (TP6 Programación Distribuida)",
    protocolo: req.protocol,
    recursos: ["/api/vehiculos", "/api/repuestos", "/api/ordenes"],
    docs: "/api-docs",
    salud: ["/health", "/health/servicios"],
  });
});

app.use(rutas);

app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error(`${req.method} ${req.originalUrl}: error interno del gateway: ${err.message}`, err);
  res.status(500).json({ error: "Error interno del gateway." });
});

module.exports = app;
module.exports.config = config;
