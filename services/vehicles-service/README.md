# vehicles-service

Parque de vehículos del taller. Es el **único dueño** de la colección
`vehiculos` (base MongoDB `vehicles`) y de la regla de **patente única**.
TP6 · torque · responsable: Manuel Moya.

TP7 (JWT + roles) y correcciones de la 1ª revisión (dueño, duplicado, baja
lógica) · responsable: Manuel Moya.

## Endpoints

| Método | Ruta | Respuestas |
|---|---|---|
| GET | `/api/vehiculos?patente=&incluirInactivos=` | 200 (por defecto solo activos) · 503 |
| GET | `/api/vehiculos/patente/:patente` | 200 (activo o no) · 404 — ¿el auto ya está cargado? |
| GET | `/api/vehiculos/:id` | 200 (también inactivos, con `activo:false`) · 400 · 404 · 503 |
| POST | `/api/vehiculos` | 201 · 400 (incluye dueño faltante) · **409 con `vehiculoExistente`** si la patente ya está cargada · 503 |
| PUT | `/api/vehiculos/:id` | 200 · 400 · 404 · 409 (patente de otro / vehículo dado de baja) · 503 |
| DELETE | `/api/vehiculos/:id` | 200 **baja lógica** `{motivo?}` (queda `activo:false`, idempotente) · 400 · 404 · 503 |
| POST | `/api/vehiculos/:id/reactivar` | 200 · 404 |
| GET | `/health` | 200 `{service, status:"ok", dependencias:{mongo:"up"}}` · 503 si Mongo no está |
| GET | `/metrics` | métricas del proceso (JSON, o `?formato=prometheus`) |

Cada vehículo guarda `duenio: { nombre, telefono }` (obligatorios) para avisarle
cuando el auto está listo. La patente se normaliza (mayúsculas, sin espacios ni
guiones). La baja **no borra**: conserva el historial, el auto deja de listarse
por defecto y no admite órdenes nuevas. El historial de órdenes del auto está en
workorders-service: `GET /api/ordenes/vehiculo/:vehiculoId`.
| GET | `/api-docs` · `/api-docs.json` | Swagger UI · spec OpenAPI 3 |

`workorders-service` usa `GET /api/vehiculos/:id` y `GET /api/vehiculos/patente/:p`
para validar la referencia de una orden (contrato público, nunca la base).

## Seguridad (TP7)

Todo `/api/vehiculos` requiere `Authorization: Bearer <token>` (emitido por
auth-service). El token se verifica **localmente** (`src/middleware/auth.js`:
HS256, `iss`, `aud`, `exp`), sin consultar ninguna base de usuarios.

| Endpoint | MECANICO | ADMIN | Sin token / token inválido |
|---|---|---|---|
| `GET /api/vehiculos` · `GET /:id` | ✔ | ✔ | 401 |
| `POST /api/vehiculos` · `PUT /:id` | ✔ | ✔ | 401 |
| `GET /api/vehiculos/patente/:p` | ✔ | ✔ | 401 |
| `DELETE /api/vehiculos/:id` (baja lógica) · `POST /:id/reactivar` | **403** | ✔ | 401 |

`/health` y `/api-docs` siguen públicos. Detalle de 401 vs 403:
[docs/tp7/errores-401-403.md](../../docs/tp7/errores-401-403.md).

## Estructura

```
src/
  index.js              arranque: abre el puerto, conecta Mongo con reintentos, índices y seed
  app.js                Express: request id, log por request, /health, Swagger, manejo de errores
  middleware/auth.js    validación del JWT (401) y autorización por rol (403)
  routes/vehiculos.js   rutas → controladores
  controllers/          adapta HTTP ↔ caso de uso
  services/vehiculos.js reglas de negocio (validación, dueño, patente única/duplicado, baja lógica)
  models/               schema Mongoose + seed (3 vehículos con ids fijos y dueño)
  config/               variables de entorno, logger (Winston a stdout), conexión Mongo, métricas
  utils/                errores HTTP, validación de ids
  docs/openapi.js       contrato OpenAPI
```

## Variables de entorno

| Variable | Local | Docker Compose | Descripción |
|---|---|---|---|
| `PORT` | `3001` | `3000` | puerto HTTP interno |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/vehicles` | `mongodb://vehicles-db:27017/vehicles` | base propia |
| `MONGO_RETRY_MS` | `3000` | `3000` | espera entre reintentos de conexión |
| `SEED_ON_START` | `true` | `true` | carga 3 vehículos si la colección está vacía |
| `JWT_SECRET` | (≥ 32 caracteres) | `${JWT_SECRET}` del `.env` raíz | clave HS256 para **verificar** tokens (la misma que auth-service). Sin ella no arranca |
| `JWT_ISSUER` · `JWT_AUDIENCE` | `torque-auth` · `torque` | ídem | emisor y audiencia esperados |
| `LOG_LEVEL` | `info` | `info` | nivel de Winston |

Ver `.env.example`. El `.env` real no se versiona.

## Ejecutar con Node (sin Docker)

```bash
cd services/vehicles-service
cp .env.example .env        # MongoDB local en :27017
npm install
npm start                   # http://localhost:3001/health · /api-docs
```

## Ejecutar con Docker (imagen individual)

```bash
docker build -t torque/vehicles-service:tp6 ./services/vehicles-service
docker run --rm -p 3001:3000 -e MONGODB_URI=mongodb://host.docker.internal:27017/vehicles torque/vehicles-service:tp6
```

Sin base disponible el contenedor **igual arranca**: `/health` responde `503`
(`degraded`) y la conexión se reintenta cada `MONGO_RETRY_MS`.

## Comportamiento ante fallos

- MongoDB caída al arrancar: el proceso no termina; reintenta y `/health` = 503.
- MongoDB cae después: las operaciones responden `503` (`"La base de datos de vehicles-service no está disponible."`); el driver reconecta solo.
- `bufferCommands` desactivado: sin base la consulta falla enseguida en vez de quedar colgada.
