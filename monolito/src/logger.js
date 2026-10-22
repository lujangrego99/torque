const fs = require("fs");
const path = require("path");
const winston = require("winston");
require("winston-daily-rotate-file");

const LOG_DIR = path.resolve(process.cwd(), process.env.LOG_DIR || "./logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

const nivel = process.env.LOG_LEVEL || "info";
const maxSize = process.env.LOG_MAX_SIZE || "5m";
const maxFiles = process.env.LOG_MAX_FILES || "7d";

const formato = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    const extra = stack ? `\n${stack}` : "";
    return `${timestamp} [${level.toUpperCase()}] ${message}${extra}`;
  })
);

const transporteApp = new winston.transports.DailyRotateFile({
  dirname: LOG_DIR,
  filename: "app-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxSize,
  maxFiles,
  zippedArchive: false,
  level: nivel,
  auditFile: path.join(LOG_DIR, ".app-audit.json"),
});

const transporteError = new winston.transports.DailyRotateFile({
  dirname: LOG_DIR,
  filename: "error-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxSize,
  maxFiles,
  zippedArchive: false,
  level: "error",
  auditFile: path.join(LOG_DIR, ".error-audit.json"),
});

const logger = winston.createLogger({
  level: nivel,
  format: formato,
  transports: [
    transporteApp,
    transporteError,
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), formato),
    }),
  ],
});

transporteApp.on("rotate", (viejo, nuevo) => {
  logger.info(`Rotación del log de aplicación: ${path.basename(viejo)} -> ${path.basename(nuevo)}`);
});

transporteError.on("rotate", (viejo, nuevo) => {
  logger.error(`Rotación del log de errores: ${path.basename(viejo)} -> ${path.basename(nuevo)}`);
});

module.exports = logger;
module.exports.LOG_DIR = LOG_DIR;
module.exports.maxSize = maxSize;
module.exports.maxFiles = maxFiles;
