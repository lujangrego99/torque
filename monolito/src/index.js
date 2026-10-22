require("dotenv").config();

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const express = require("express");
const { cargarConfig } = require("./raft/config");

const config = cargarConfig();

// Aplicar puertos/DB/logs derivados del NODE_ID salvo override explícito en .env
if (!process.env.PORT) process.env.PORT = String(config.port);
if (!process.env.HTTPS_PORT) process.env.HTTPS_PORT = String(config.httpsPort);
if (!process.env.MONGODB_URI) process.env.MONGODB_URI = config.mongoUri;
// Un directorio de log por nodo evita locks de winston entre procesos.
if (!process.env.LOG_DIR || process.env.LOG_DIR === "./logs") {
  process.env.LOG_DIR = `./logs/${config.nodeId}`;
}

const { crearApp } = require("./app");
const logger = require("./logger");
const { conectar: conectarRedis, urlRedis, redactarUrl } = require("./redis");
const { conectar: conectarMongo } = require("./mongo");
const { seedSiVacio } = require("./seed");
const { RaftNode } = require("./raft/node");
const { crearRaftRpcRouter } = require("./raft/rpcRoutes");

const HTTP_PORT = Number(process.env.PORT) || config.port;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || config.httpsPort;
const RAFT_PORT = Number(process.env.RAFT_PORT) || config.raftPort;
const ENABLE_HTTP = process.env.ENABLE_HTTP !== "false";

let raftNode = null;

function getRaftNode() {
  return raftNode;
}

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

  logger.info(
    `Arranque nodo=${config.nodeId} api=${HTTP_PORT} https=${HTTPS_PORT} raft=${RAFT_PORT} db=${config.mongoDb}`
  );

  await conectarMongo();
  await seedSiVacio();

  raftNode = new RaftNode(config);
  await raftNode.start();

  try {
    await conectarRedis();
    logger.info(`Redis/Memurai conectado en ${redactarUrl(urlRedis())}`);
  } catch (err) {
    logger.warn(`No se pudo conectar a Redis (${redactarUrl(urlRedis())}): ${err.message}`);
    logger.warn(
      "Arranca igual; POST /api/repuestos/:id/descontar responderá 503 hasta que Redis esté disponible."
    );
  }

  const app = crearApp(getRaftNode);
  app.set("raft", raftNode);

  const raftApp = express();
  raftApp.use(express.json());
  raftApp.use("/raft", crearRaftRpcRouter(getRaftNode));
  raftApp.get("/", (req, res) => {
    res.status(200).json({
      mensaje: "RPC interno Raft (no usar como API de negocio)",
      nodeId: config.nodeId,
      endpoints: ["/raft/request-vote", "/raft/append-entries"],
    });
  });

  http.createServer(raftApp).listen(RAFT_PORT, () => {
    logger.info(`Raft  escuchando en http://localhost:${RAFT_PORT}`);
  });

  if (ENABLE_HTTP) {
    http.createServer(app).listen(HTTP_PORT, () => {
      logger.info(`HTTP  escuchando en http://localhost:${HTTP_PORT}`);
    });
  }

  const httpsServer = https.createServer(opcionesHttps(), app);
  httpsServer.listen(HTTPS_PORT, () => {
    logger.info(`HTTPS escuchando en https://localhost:${HTTPS_PORT}`);
    logger.info(`Swagger UI en https://localhost:${HTTPS_PORT}/api-docs`);
    logger.info(`Diagnóstico Raft: http://localhost:${HTTP_PORT}/api/raft/status`);
  });
}

iniciar().catch((err) => {
  logger.error(`No se pudo iniciar: ${err.message}`);
  process.exit(1);
});
