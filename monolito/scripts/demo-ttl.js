require("dotenv").config();

const { createClient } = require("redis");

const URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const KEY = "lock:repuesto:ttl-demo";
const TOKEN = "demo-owner-token";
const TTL_MS = 4000;

async function main() {
  const redis = createClient({ url: URL });
  redis.on("error", (err) => console.error("Redis:", err.message));
  await redis.connect();

  console.log("PING:", await redis.ping());

  await redis.del(KEY);
  const set = await redis.set(KEY, TOKEN, { NX: true, PX: TTL_MS });
  console.log("SET NX PX:", set);
  console.log("GET inmediato:", await redis.get(KEY));
  console.log("PTTL inmediato (ms):", await redis.pTTL(KEY));

  await new Promise((resolve) => setTimeout(resolve, 1500));
  console.log("GET a 1.5 s:", await redis.get(KEY));
  console.log("PTTL a 1.5 s (ms):", await redis.pTTL(KEY));

  await new Promise((resolve) => setTimeout(resolve, TTL_MS));
  console.log("GET luego de vencer el TTL:", await redis.get(KEY));
  console.log("PTTL luego de vencer:", await redis.pTTL(KEY));

  await redis.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
