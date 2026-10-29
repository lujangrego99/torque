const winston = require("winston");
const config = require("./index");

// Logs a stdout/stderr para que `docker compose logs` los muestre.
// Cada línea lleva el nombre del servicio que la generó.
const formato = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    const extra = stack ? `\n${stack}` : "";
    return `${timestamp} [${level.toUpperCase()}] [${config.serviceName}] ${message}${extra}`;
  })
);

const logger = winston.createLogger({
  level: config.logLevel,
  format: formato,
  transports: [new winston.transports.Console({ stderrLevels: ["error"] })],
});

module.exports = logger;
