# api-gateway

Punto de entrada único de torque. Termina HTTPS (certificado autofirmado del
TP2), enruta por prefijo hacia el servicio dueño y publica el Swagger agregado.
No tiene datos ni reglas de negocio. TP6 · torque · responsable: Gregorio Luján.

## Rutas

| Ruta | Destino |
|---|---|
| `/api/vehiculos*` | `vehicles-service` |
| `/api/repuestos*` | `inventory-service` |
| `/api/ordenes*` | `workorders-service` |
| `GET /health` | salud del gateway: `{service:"api-gateway", status:"ok"}` |
| `GET /health/servicios` | salud agregada: consulta `/health` de cada servicio (200 si todos ok, 503 si alguno no) |
| `GET /api-docs` | Swagger UI con selector: vehicles · inventory · workorders · gateway |
| `GET /api-docs/<servicio>.json` | spec real de cada servicio (lo trae de su `/api-docs.json`) |

- Las respuestas del servicio (2xx/4xx/5xx) se devuelven **sin modificar**.
- Si el servicio no responde (timeout, DNS, conexión rechazada): `503` propio con `servicio` y `causa`.
- Genera o propaga `x-request-id` hacia los servicios: la misma operación se sigue en `docker compose logs`.

## HTTPS

- HTTP en `PORT` (3000) siempre; HTTPS en `HTTPS_PORT` (3443) **si existen** `certs/server.key` y `certs/server.crt`.
- `bash scripts/generar-certificado.sh` (o `npm run cert`) los genera. No se versionan ni entran en la imagen: Compose monta `./certs` en `/app/certs:ro`.
- Entre contenedores se usa HTTP (simplificación permitida por el TP6).

## Variables de entorno

| Variable | Local | Docker Compose |
|---|---|---|
| `PORT` | `3000` | `3000` (publicado como `GATEWAY_HTTP_PORT`) |
| `HTTPS_PORT` | `3443` | `3443` (publicado como `GATEWAY_HTTPS_PORT`) |
| `SSL_KEY_PATH` / `SSL_CERT_PATH` | `./certs/server.key` / `.crt` | `/app/certs/server.key` / `.crt` |
| `VEHICLES_SERVICE_URL` | `http://localhost:3001` | `http://vehicles-service:3000` |
| `INVENTORY_SERVICE_URL` | `http://localhost:3002` | `http://inventory-service:3000` |
| `WORKORDERS_SERVICE_URL` | `http://localhost:3003` | `http://workorders-service:3000` |
| `PROXY_TIMEOUT_MS` | `15000` | `15000` |
| `HEALTH_TIMEOUT_MS` | `2000` | `2000` |
| `LOG_LEVEL` | `info` | `info` |

## Ejecutar con Node

```bash
cd services/api-gateway
cp .env.example .env
npm install
npm run cert      # opcional, para HTTPS
npm start         # http://localhost:3000/api-docs
```

## Docker (imagen individual)

```bash
docker build -t torque/api-gateway:tp6 ./services/api-gateway
docker run --rm -p 3000:3000 torque/api-gateway:tp6   # /health = 200 aunque los servicios no estén
```
