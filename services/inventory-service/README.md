# inventory-service

Stock de repuestos y descuento sin corrupción concurrente. Es el **único dueño**
de las colecciones `repuestos` y `movimientos` (base MongoDB `inventory`) y de
los locks `lock:repuesto:{id}` en Redis. TP6 · torque · responsable: Jan Lahorca.

TP7 (JWT + roles) y correcciones de la 1ª revisión (movimientos, alta, ingreso,
ajuste, reposición, laboratorio por variable) · responsable: Jan Lahorca.

## Endpoints

| Método | Ruta | Respuestas |
|---|---|---|
| GET | `/api/repuestos` | 200 · 401 · 503 |
| POST | `/api/repuestos` | 201 alta (código único; stock inicial = INGRESO) · 400 · 409 código duplicado |
| GET | `/api/repuestos/movimientos?repuestoId=&ordenId=&tipo=&limite=` | 200 libro de movimientos (MECANICO: los suyos) · 400 |
| GET | `/api/repuestos/:id` | 200 · 400 · 404 · 503 |
| POST | `/api/repuestos/:id/ingreso` | 200 `{cantidad, motivo?}` · 400 · 404 |
| POST | `/api/repuestos/:id/ajuste` | 200 `{cantidad (±), motivo}` · 400 sin motivo · 409 dejaría stock negativo |
| POST | `/api/repuestos/:id/descontar` | 200 `{cantidad, ordenId}` (idempotente por orden) · 400 · 404 · 409 (sin stock / ocupado / orden cerrada) · 503 (Redis caído) |
| POST | `/api/repuestos/reposiciones` | 200 `{ordenId, repuestoIds?, motivo?}` repone lo que el libro dice que descontó la orden (idempotente) · 403 |
| GET | `/api/repuestos/:id/lock` | **laboratorio** — 200 (estado del lock) · 503 (Redis caído) |
| POST | `/api/repuestos/:id/descontar-sin-lock` | **laboratorio** — demo de carrera del TP2 |
| POST | `/api/repuestos/reiniciar` | **laboratorio** — restaura la semilla (filtro 1, pastillas 4, bujías 8) y el libro |
| GET | `/health` | 200 si Mongo está (`status: "degraded"` si Redis no) · 503 si Mongo no está |
| GET | `/metrics` | métricas del proceso (JSON, o `?formato=prometheus`) |
| GET | `/api-docs` · `/api-docs.json` | Swagger UI · spec OpenAPI 3 |

Los endpoints de **laboratorio** solo existen con `LAB_ENDPOINTS=true` (si no, 404 y no figuran en Swagger).

`workorders-service` usa `GET /api/repuestos/:id`, `POST /api/repuestos/:id/descontar` (con el `ordenId`) y `POST /api/repuestos/reposiciones`.

## Libro de movimientos y reposición

- Cada cambio de stock deja una línea en `movimientos`: `INGRESO`, `AJUSTE`, `DESCUENTO` o `REPOSICION`, con cantidad (con signo), saldo anterior y resultante, usuario (`sub`), fecha, motivo y `ordenId`.
- Índice único `(ordenId, repuestoId, tipo)`: una orden descuenta y repone cada repuesto **una sola vez**.
- La reposición es un **contramovimiento** ligado a la orden, no un rollback. Para un descuento incierto (timeout) se consulta el libro bajo el lock; si no se aplicó, una REPOSICION de 0 bloquea un descuento tardío (409 "Orden cerrada").
- Detalle: [docs/correcciones §3.2–3.3](../../docs/correcciones/README.md).

## Concurrencia (TP2 → TP6)

- `SET lock:repuesto:{id} <token> NX PX LOCK_TTL_MS` para entrar a la sección crítica.
- Dentro: leer stock → `DEMO_DELAY_MS` → `$inc`. **A propósito** no hay filtro `{stock: {$gte}}`: el lock es el que evita el oversell.
- Liberación con Lua (`GET == token ? DEL`), para no borrar el lock de otra operación si el TTL venció.
- `LOCK_TTL_MS` tiene que ser mayor que `DEMO_DELAY_MS` (al arrancar avisa si no lo es).
- Cliente Redis sin cola offline y con reconexión: si Redis cae, el descuento responde `503` al instante y se recupera solo cuando Redis vuelve.

## Seguridad (TP7)

El token (emitido por auth-service) se verifica **localmente**
(`src/middleware/auth.js`: HS256, `iss`, `aud`, `exp`).

| Endpoint | Sin token | MECANICO | ADMIN |
|---|---|---|---|
| `GET /api/repuestos` · `GET /:id` · `GET /movimientos` | 401 | ✔ (movimientos: los suyos) | ✔ |
| `POST /api/repuestos` · `/:id/ingreso` · `/:id/ajuste` | 401 | **403** | ✔ |
| `POST /api/repuestos/:id/descontar` | 401 | ✔ | ✔ |
| `POST /api/repuestos/reposiciones` | 401 | ✔ si hizo los descuentos (si no, 403) | ✔ |
| `reiniciar` · `/:id/lock` · `/:id/descontar-sin-lock` | 404 sin `LAB_ENDPOINTS=true`; con la variable 401 / **403** / ✔ | | |

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
  services/repuestos.js  reglas de stock, sección crítica, movimientos y reposición
  models/                repuesto, movimiento (libro) + seed (ids fijos)
  config/                env, logger, Mongo, Redis, lock, métricas
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
| `SEED_ON_START` | `true` | `true` | carga 3 repuestos (y su INGRESO inicial) si la colección está vacía |
| `LAB_ENDPOINTS` | `false` | `${LAB_ENDPOINTS:-false}` | habilita reiniciar / lock / descontar-sin-lock |
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

Con `LAB_ENDPOINTS=true` y un token de ADMIN en `$T` (todo requiere autenticación):

```bash
H="Authorization: Bearer $T"; J='content-type: application/json'
# sin lock: los dos pasan y el stock queda en -1 (el libro muestra los dos descuentos)
curl -X POST localhost:3002/api/repuestos/reiniciar -H "$H"
curl -X POST localhost:3002/api/repuestos/68c000000000000000000011/descontar-sin-lock -H "$H" & \
curl -X POST localhost:3002/api/repuestos/68c000000000000000000011/descontar-sin-lock -H "$H"; wait

# con lock (cada descuento para una orden distinta): uno 200 y el otro 409 "Recurso ocupado"; stock 0
curl -X POST localhost:3002/api/repuestos/reiniciar -H "$H"
curl -X POST localhost:3002/api/repuestos/68c000000000000000000011/descontar -H "$H" -H "$J" -d '{"ordenId":"6730a1b2c3d4e5f6000000a1"}' & \
curl -X POST localhost:3002/api/repuestos/68c000000000000000000011/descontar -H "$H" -H "$J" -d '{"ordenId":"6730a1b2c3d4e5f6000000b2"}'; wait
```

Versión completa con evidencias: `bash scripts/pruebas-correcciones.sh 10-`.
