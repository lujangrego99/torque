# workorders-service

Órdenes de trabajo del taller (servicio **nuevo** del TP6). Registra el
trabajo sobre un vehículo y consume repuestos. Es el **único dueño** de la
colección `ordenes` (base MongoDB `workorders`). TP6 · torque · responsable:
Agustín Martínez.

No tiene acceso a las bases de vehículos ni de inventario: los consulta por su
**interfaz HTTP pública** y guarda solo sus ids (referencias lógicas).

## Endpoints

| Método | Ruta | Respuestas |
|---|---|---|
| POST | `/api/ordenes` | 201 CONFIRMADA · 400 · 404 vehículo/repuesto inexistente · 409 FALLIDA por stock · 502 · 503 dependencia caída |
| GET | `/api/ordenes?estado=&vehiculoId=` | 200 · 400 · 503 |
| GET | `/api/ordenes/:id` | 200 · 400 · 404 |
| GET | `/health` | 200 / 503 según su propia base (no depende de los otros servicios) |
| GET | `/api-docs` · `/api-docs.json` | Swagger UI · spec OpenAPI 3 |

Body de `POST /api/ordenes`:

```json
{
  "vehiculoId": "68c000000000000000000001",
  "descripcion": "Cambio de pastillas delanteras",
  "repuestos": [{ "repuestoId": "68c000000000000000000012", "cantidad": 2 }]
}
```

## Flujo de la creación

1. `vehicles-service` `GET /api/vehiculos/:id`: el vehículo existe (404 → no se crea nada).
2. `inventory-service` `GET /api/repuestos/:id` por ítem: el repuesto existe.
3. Guarda la orden `PENDIENTE`.
4. `inventory-service` `POST /api/repuestos/:id/descontar` por ítem, en orden, y guarda el estado de cada ítem.
5. `CONFIRMADA` si todos se descontaron. Si no, `FALLIDA` con `falla` y `requiereCompensacion`.

La regla de stock **no** se duplica: este servicio no compara stock, solo
interpreta la respuesta de inventory. Análisis completo:
[`docs/tp6/fallo-parcial.md`](../../docs/tp6/fallo-parcial.md).

## Clientes HTTP (`src/clients/`)

- `http.js`: `fetch` nativo + `AbortSignal.timeout`, propagación de `x-request-id`
  y clasificación del error (`timeout`, `dns`, `conexion_rechazada`, `red`,
  `no_disponible` para 503 remoto, `error_remoto` para otros 5xx).
  Las respuestas 4xx **no** son excepción: vuelven al negocio como error funcional.
- `vehicles.js` y `inventory.js`: único lugar donde están las rutas de los otros servicios.

| Situación remota | Respuesta de este servicio |
|---|---|
| 404 | 404 (no se convierte en 503) |
| 409 | 409, orden FALLIDA |
| timeout / DNS / conexión rechazada / 503 remoto | 503 controlado (en un descuento por timeout el ítem queda `INCIERTO`) |
| otro 5xx | 502 |

## Estructura

```
src/
  index.js               arranque: puerto, Mongo con reintentos, índices
  app.js                 Express: request id, log, /health, Swagger, errores
  routes/ controllers/   HTTP
  services/ordenes.js    caso de uso "crear orden" y consultas
  clients/               comunicación con vehicles-service e inventory-service
  models/orden.js        schema (estados de orden e ítems)
  config/                env, logger, Mongo
  docs/openapi.js        contrato OpenAPI
```

## Variables de entorno

| Variable | Local | Docker Compose | Descripción |
|---|---|---|---|
| `PORT` | `3003` | `3000` | puerto HTTP interno |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/workorders` | `mongodb://workorders-db:27017/workorders` | base propia |
| `VEHICLES_SERVICE_URL` | `http://localhost:3001` | `http://vehicles-service:3000` | interfaz de vehicles |
| `INVENTORY_SERVICE_URL` | `http://localhost:3002` | `http://inventory-service:3000` | interfaz de inventory |
| `VEHICLES_TIMEOUT_MS` | `2000` | `2000` | timeout hacia vehicles |
| `INVENTORY_TIMEOUT_MS` | `5000` | `5000` | timeout hacia inventory (> `DEMO_DELAY_MS`) |
| `MONGO_RETRY_MS` | `3000` | `3000` | reintentos de conexión |
| `LOG_LEVEL` | `info` | `info` | nivel de Winston |

## Ejecutar con Node (sin Docker)

Necesita vehicles-service (:3001) e inventory-service (:3002) levantados.

```bash
cd services/workorders-service
cp .env.example .env
npm install
npm start                   # http://localhost:3003/health · /api-docs
```

## Ejecutar con Docker (imagen individual)

```bash
docker build -t torque/workorders-service:tp6 ./services/workorders-service
docker run --rm -p 3003:3000 \
  -e MONGODB_URI=mongodb://host.docker.internal:27017/workorders \
  -e VEHICLES_SERVICE_URL=http://host.docker.internal:3001 \
  -e INVENTORY_SERVICE_URL=http://host.docker.internal:3002 \
  torque/workorders-service:tp6
```
