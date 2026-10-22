require("dotenv").config();

const logger = require("../src/logger");

logger.info("Evento INFO de evidencia (operación normal).");
logger.warn("Evento WARN de evidencia (solicitud rechazada, el servicio sigue).");
logger.error("Evento ERROR de evidencia (fallo que requiere diagnóstico).");
console.log("Escritos INFO/WARN/ERROR en", logger.LOG_DIR);
