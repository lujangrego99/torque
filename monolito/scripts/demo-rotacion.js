require("dotenv").config();

const fs = require("fs");
const path = require("path");
const winston = require("winston");
require("winston-daily-rotate-file");

const dir = path.resolve(process.cwd(), "logs", "rotacion-demo");
fs.mkdirSync(dir, { recursive: true });

const transporte = new winston.transports.DailyRotateFile({
  dirname: dir,
  filename: "app-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxSize: "1k",
  maxFiles: 3,
  zippedArchive: false,
  auditFile: path.join(dir, ".audit.json"),
});

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
  ),
  transports: [transporte],
});

let rotaciones = 0;
transporte.on("rotate", (viejo, nuevo) => {
  rotaciones += 1;
  console.log("ROTATE", path.basename(viejo), "->", path.basename(nuevo));
});

async function main() {
  console.log("Directorio:", dir);
  console.log("Criterio de rotación: maxSize=1k, retención maxFiles=3");

  for (let i = 1; i <= 80; i += 1) {
    logger.info(`evento de prueba ${i} ${"x".repeat(80)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const archivos = fs
    .readdirSync(dir)
    .filter((nombre) => nombre.includes(".log"))
    .sort();
  console.log("Archivos de log:", archivos);
  for (const nombre of archivos) {
    const full = path.join(dir, nombre);
    const st = fs.statSync(full);
    console.log(`  ${nombre}  ${st.size} bytes`);
  }
  console.log("Rotaciones observadas:", rotaciones);
  console.log("Retención: maxFiles=3 elimina los más viejos cuando se supera el cupo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
