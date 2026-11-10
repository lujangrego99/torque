const express = require("express");
const swaggerUi = require("swagger-ui-express");
const health = require("../controllers/health");
const docs = require("../controllers/docs");
const proxy = require("../controllers/proxy");
const spec = require("../docs/openapi");
const config = require("../config");
const metricas = require("../config/metricas");

const router = express.Router();

// Express 4 no captura rechazos de funciones async: se pasan a next().
const capturar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", health.propia);
router.get("/health/servicios", capturar(health.servicios));

// Observabilidad: métricas del gateway y agregado de los servicios internos.
router.get("/metrics", metricas.endpoint(config.serviceName));
router.get("/metrics/servicios", capturar(health.metricas));

router.get("/api-docs/gateway.json", (req, res) => res.json(spec));
router.get("/api-docs/:servicio.json", capturar(docs.specDe));
router.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(null, {
    customSiteTitle: "torque — Swagger (api-gateway)",
    explorer: true,
    swaggerOptions: {
      // El token cargado con "Authorize" se conserva al cambiar de servicio en el selector.
      persistAuthorization: true,
      urls: [
        { url: "/api-docs/vehicles.json", name: "vehicles-service" },
        { url: "/api-docs/inventory.json", name: "inventory-service" },
        { url: "/api-docs/workorders.json", name: "workorders-service" },
        { url: "/api-docs/auth.json", name: "auth-service (login)" },
        { url: "/api-docs/gateway.json", name: "api-gateway" },
      ],
    },
  })
);

// Todo /api/* se reenvía al servicio dueño del prefijo.
router.use("/api", capturar(proxy.reenviar));

module.exports = router;
