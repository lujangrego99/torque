const express = require("express");
const swaggerUi = require("swagger-ui-express");
const { randomUUID } = require("crypto");
const config = require("./config");
const logger = require("./config/logger");
const { conectado } = require("./config/mongo");
const redis = require("./config/redis");
const { ErrorHttp, esBaseNoDisponible } = require("./utils/errores");
const spec = require("./docs/openapi");
const repuestosRouter = require("./routes/repuestos");

const app = express();

app.use(express.json());

// Log por request: método, ruta, status, duración y request id (lo propaga el gateway).
app.use((req, res, next) => {
  const inicio = Date.now();
  req.id = req.get("x-request-id") || randomUUID();
  res.set("x-request-id", req.id);
  res.on("finish", () => {
    const linea = `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - inicio}ms rid=${req.id}`;
    if (res.statusCode >= 500) logger.error(linea);
    else if (res.statusCode >= 400) logger.warn(linea);
    else if (req.path !== "/health") logger.info(linea);
  });
  next();
});

// Salud: 200 si el proceso y su base están disponibles; 503 si solo el proceso.
// Redis caído no lo vuelve indisponible (las consultas siguen andando), pero se
// informa como "degraded": el descuento seguro responde 503 hasta que vuelva.
// No expone URIs ni credenciales.
app.get("/health", (req, res) => {
  const mongo = conectado() ? "up" : "down";
  const redisEstado = redis.disponible() ? "up" : "down";
  res.status(mongo === "up" ? 200 : 503).json({
    service: config.serviceName,
    status: mongo === "up" && redisEstado === "up" ? "ok" : "degraded",
    dependencias: { mongo, redis: redisEstado },
  });
});

app.get("/api-docs.json", (req, res) => res.json(spec));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: "inventory-service — Swagger" }));

app.use("/api/repuestos", repuestosRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada." });
});

// Manejo centralizado: distingue error funcional (4xx), base caída (503) y
// fallo propio inesperado (500).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Datos inválidos o incompletos.", detalles: ["El body no es un JSON válido."] });
  }
  if (err instanceof ErrorHttp) {
    if (err.status >= 400 && err.status < 500) {
      logger.warn(`${req.method} ${req.originalUrl}: ${err.error}${err.detalles ? ` (${err.detalles.join("; ")})` : ""}`);
    }
    return res.status(err.status).json({
      error: err.error,
      ...(err.detalles ? { detalles: err.detalles } : {}),
      ...(err.item ? { item: err.item } : {}),
    });
  }
  if (esBaseNoDisponible(err)) {
    logger.error(`${req.method} ${req.originalUrl}: MongoDB no disponible (${err.message}).`);
    return res.status(503).json({
      error: "Servicio no disponible.",
      detalles: [`La base de datos de ${config.serviceName} no está disponible.`],
    });
  }
  logger.error(`${req.method} ${req.originalUrl}: error interno: ${err.message}`, err);
  return res.status(500).json({ error: "Error interno del servidor." });
});

module.exports = app;
