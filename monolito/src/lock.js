const { randomUUID } = require("crypto");
const { getRedis } = require("./redis");

const SCRIPT_LIBERAR = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

function ttlMs() {
  const valor = Number(process.env.LOCK_TTL_MS);
  return Number.isInteger(valor) && valor > 0 ? valor : 8000;
}

function clave(recurso, id) {
  return `lock:${recurso}:${id}`;
}

async function adquirir(recurso, id) {
  const token = randomUUID();
  const key = clave(recurso, id);
  const redis = getRedis();
  const resultado = await redis.set(key, token, {
    NX: true,
    PX: ttlMs(),
  });

  if (resultado !== "OK") {
    return null;
  }

  return { key, token, recurso, id };
}

async function liberar(lock) {
  if (!lock || !lock.key || !lock.token) {
    return false;
  }

  const redis = getRedis();
  const resultado = await redis.eval(SCRIPT_LIBERAR, {
    keys: [lock.key],
    arguments: [lock.token],
  });

  return resultado === 1;
}

async function inspeccionar(recurso, id) {
  const redis = getRedis();
  const key = clave(recurso, id);
  const [valor, ttl] = await Promise.all([redis.get(key), redis.pTTL(key)]);

  return {
    clave: key,
    existe: valor !== null,
    propietario: valor,
    ttlMs: ttl,
  };
}

module.exports = {
  adquirir,
  liberar,
  inspeccionar,
  clave,
  ttlMs,
};
