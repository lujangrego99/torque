# inventory-service

Stock de repuestos y descuento sin corrupción concurrente. Es el **único dueño**
de la colección `repuestos` (base MongoDB `inventory`) y de los locks
`lock:repuesto:{id}` en Redis. TP6 · torque · responsable: Jan Lahorca.

TP7 (JWT + roles) · responsable: Jan Lahorca.

## Endpoints

| Método | Ruta | Respuestas |
|---|---|---|
| GET | `/api/repuestos` | 200 · 503 |
| GET | `/api/repuestos/:id` | 200 · 400 · 404 · 503 |
| GET | `/api/repuestos/:id/lock` | 200 (estado del lock) · 400 · 503 (Redis caído) |
| POST | `/api/repuestos/:id/descontar` | 200 · 400 · 404 · 409 (sin stock / recurso ocupado) · 503 (Redis caído) |
| POST | `/api/repuestos/:id/descontar-sin-lock` | 200 · 400 · 404 · 409 — demo de carrera del TP2 |
| POST | `/api/repuestos/reiniciar` | 200 — restaura la semilla (filtro 1, pastillas 4, bujías 8) |
| GET | `/health` | 200 si Mongo está (`status: "degraded"` si Redis no) · 503 si Mongo no está |
| GET | `/api-docs` · `/api-docs.json` | Swagger UI · spec OpenAPI 3 |

`workorders-service` usa `GET /api/repuestos/:id` y `POST /api/repuestos/:id/descontar`.

## Concurrencia (TP2 → TP6)

- `SET lock:repuesto:{id} <token> NX PX LOCK_TTL_MS` para entrar a la sección crítica.
- Dentro: leer stock → `DEMO_DELAY_MS` → `$inc`. **A propósito** no hay filtro `{stock: {$gte}}`: el lock es el que evita el oversell.
- Liberación con Lua (`GET == token ? DEL`), para no borrar el lock de otra operación si el TTL venció.
- `LOCK_TTL_MS` tiene que ser mayor que `DEMO_DELAY_MS` (al arrancar avisa si no lo es).
- Cliente Redis sin cola offline y con reconexión: si Redis cae, el descuento responde `503` al instante y se recupera solo cuando Redis vuelve.

## Seguridad (TP7)

El token (emitido por auth-service) se verifica **localmente**
(`src/middleware/auth.js`: HS256, `iss`, `aud`, `exp`).

| Endpoint | Público | MECANICO | ADMIN |
|---|---|---|---|
| `GET /api/repuestos` · `GET /:id` | ✔ | ✔ | ✔ |
| `POST /api/repuestos/:id/descontar` | 401 | ✔ | ✔ |
| `POST /api/repuestos/reiniciar` | 401 | **403** | ✔ |
| `GET /api/repuestos/:id/lock` | 401 | **403** | ✔ |
| `POST /api/repuestos/:id/descontar-sin-lock` | 401 | **403** | ✔ |

workorders-service llama a `descontar` con el **token del usuario** que crea la
orden. Configuración y manejo de secretos:
[docs/tp7/secretos-y-configuracion.md](../../docs/tp7/secretos-y-configuracion.md).

## Estructura

```
src/
  index.js               arranque: puerto, Mongo con reintentos, Redis en segundo plano, seed
  app.js                 Express: request id, log, /health, Swagger, errores
  middleware/auth.js    validación del JWT (401) y autorización por rol (403)
  routes/ controllers/   HTTP
  services/repuestos.js  reglas de stock y sección crítica
  models/                schema Mongoose + seed (ids fijos)
  config/                env, logger, Mongo, Redis, lock
  docs/openapi.js        contrato OpenAPI
```

## Variables de entorno

| Variable | Local | Docker Compose | Descripción |
|---|---|---|---|
| `PORT` | `3002` | `3000` | puerto HTTP interno |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/inventory` | `mongodb://inventory-db:27017/inventory` | base propia |
| `REDIS_URL` | `redis://127.0.0.1:6379` (Redis o **Memurai** en Windows) | `redis://redis:6379` | coordinador del lock |
| `LOCK_TTL_MS` | `8000` | `8000` | TTL del lock |
| `DEMO_DELAY_MS` | `2000` | `1000` | retardo en la sección crítica (demo de carrera) |
| `MONGO_RETRY_MS` | `3000` | `3000` | reintentos de conexión a Mongo |
| `SEED_ON_START` | `true` | `true` | carga 3 repuestos si la colección está vacía |
| `JWT_SECRET` | (≥ 32 caracteres) | `${JWT_SECRET}` del `.env` raíz | clave HS256 para **verificar** tokens (la misma que auth-service). Sin ella no arranca |
| `JWT_ISSUER` · `JWT_AUDIENCE` | `torque-auth` · `torque` | ídem | emisor y audiencia esperados |
| `LOG_LEVEL` | `info` | `info` | nivel de Winston |

## Ejecutar con Node (sin Docker)

```bash
cd services/inventory-service
cp .env.example .env        # MongoDB :27017 + Redis/Memurai :6379
npm install
npm start                   # http://localhost:3002/health · /api-docs
```

## Ejecutar con Docker (imagen individual)

```bash
docker build -t torque/inventory-service:tp6 ./services/inventory-service
docker run --rm -p 3002:3000 \
  -e MONGODB_URI=mongodb://host.docker.internal:27017/inventory \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  torque/inventory-service:tp6
```

## Probar la carrera

```bash
# sin lock: los dos pasan y el stock queda en -1
curl -X POST localhost:3002/api/repuestos/reiniciar
curl -X POST localhost:3002/api/repuestos/68c000000000000000000011/descontar-sin-lock & \
curl -X POST localhost:3002/api/repuestos/68c000000000000000000011/descontar-sin-lock; wait

# con lock: uno 200 y el otro 409 "Recurso ocupado"; stock 0
curl -X POST localhost:3002/api/repuestos/reiniciar
curl -X POST localhost:3002/api/repuestos/68c000000000000000000011/descontar & \
curl -X POST localhost:3002/api/repuestos/68c000000000000000000011/descontar; wait
```
