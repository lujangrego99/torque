const express = require("express");
const swaggerUi = require("swagger-ui-express");
const vehiculosRouter = require("./routes/vehiculos");
const repuestosRouter = require("./routes/repuestos");
const { crearRaftDiagRouter } = require("./routes/raft");
const logger = require("./logger");
const { specPara } = require("./openapi");

function crearApp(getRaftNode) {
  const app = express();

  app.use(express.json());

  app.use((req, res, next) => {
    const inicio = Date.now();
    res.on("finish", () => {
      const linea = `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - inicio}ms`;
      if (res.statusCode >= 500) {
        logger.error(linea);
      } else if (res.statusCode >= 400) {
        logger.warn(linea);
      } else {
        logger.info(linea);
      }
    });
    next();
  });

  app.get("/", (req, res) => {
    const raft = getRaftNode();
    const st = raft ? raft.status() : null;
    res.status(200).json({
      mensaje: "API REST de taller - TP N° 4 Programación Distribuida (Raft)",
      protocolo: req.secure || req.protocol === "https" ? "https" : "http",
      nodeId: st && st.nodeId,
      role: st && st.role,
      leaderId: st && st.leaderId,
      recursos: ["/api/vehiculos", "/api/repuestos", "/api/raft/status", "/api/raft/log"],
      docs: "/api-docs",
      openapi: "/api-docs.json",
      nota: "Las escrituras (POST/PUT/DELETE) requieren el Leader. Los RPC internos viven en el puerto Raft.",
    });
  });

  app.get("/api-docs.json", (req, res) => {
    res.status(200).json(specPara(req));
  });

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(null, {
      customSiteTitle: "Taller API — Swagger (TP4 Raft)",
      swaggerOptions: {
        url: "/api-docs.json",
      },
    })
  );

  app.use("/api/raft", crearRaftDiagRouter(getRaftNode));
  app.use("/api/vehiculos", vehiculosRouter);
  app.use("/api/repuestos", repuestosRouter);

  app.use((req, res) => {
    logger.warn(`Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: "Ruta no encontrada." });
  });

  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
      logger.warn("JSON malformado en el body.");
      return res.status(400).json({
        error: "Datos inválidos o incompletos.",
        detalles: ["El body no es un JSON válido."],
      });
    }

    logger.error(`Error interno: ${err.message}`);
    return res.status(500).json({ error: "Error interno del servidor." });
  });

  return app;
}

module.exports = { crearApp };
