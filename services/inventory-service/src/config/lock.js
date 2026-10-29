const { randomUUID } = require("crypto");
const config = require("./index");
const { getRedis } = require("./redis");

// Lock distribuido del TP2: SET NX PX con token, liberación con Lua que solo
// borra si el token sigue siendo el nuestro (no pisa el lock de otra operación).
const SCRIPT_LIBERAR = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

function clave(recurso, id) {
  return `lock:${recurso}:${id}`;
}

async function adquirir(recurso, id) {
  const token = randomUUID();
  const key = clave(recurso, id);
  const resultado = await getRedis().set(key, token, { NX: true, PX: config.lockTtlMs });
  return resultado === "OK" ? { key, token } : null;
}

async function liberar(lock) {
  if (!lock) {
    return false;
  }
  const resultado = await getRedis().eval(SCRIPT_LIBERAR, { keys: [lock.key], arguments: [lock.token] });
  return resultado === 1;
}

async function inspeccionar(recurso, id) {
  const redis = getRedis();
  const key = clave(recurso, id);
  const [valor, ttl] = await Promise.all([redis.get(key), redis.pTTL(key)]);
  return { clave: key, existe: valor !== null, propietario: valor, ttlMs: ttl };
}

module.exports = { adquirir, liberar, inspeccionar };
