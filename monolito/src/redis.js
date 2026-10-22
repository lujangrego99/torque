const { createClient } = require("redis");
const logger = require("./logger");

let client = null;

function urlRedis() {
  return process.env.REDIS_URL || "redis://127.0.0.1:6379";
}

function redactarUrl(url) {
  return String(url).replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@");
}

async function conectar() {
  if (client && client.isOpen) {
    return client;
  }

  client = createClient({ url: urlRedis() });
  client.on("error", (err) => {
    logger.error(`Redis: ${err.message}`);
  });

  await client.connect();
  return client;
}

function getRedis() {
  if (!client || !client.isOpen) {
    const error = new Error("Redis no está conectado.");
    error.codigo = "redis_down";
    throw error;
  }

  return client;
}

async function ping() {
  const redis = getRedis();
  return redis.ping();
}

module.exports = {
  conectar,
  getRedis,
  ping,
  urlRedis,
  redactarUrl,
};
