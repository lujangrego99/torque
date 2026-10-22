# TP N° 3 — Persistencia, logging y documentación de APIs REST

**Materia:** Programación Distribuida — Licenciatura en Sistemas de Información (UCH)  
**Estudiante:** Gregorio Luján  
**Proyecto:** continuación del TP N° 2 (API REST de un taller, HTTPS y exclusión mutua con Redis/Memurai)

El TP2 sigue intacto: HTTPS, variables de entorno, lock por recurso en Redis y el descuento de stock como sección crítica. Este TP reemplaza el arreglo en memoria por MongoDB, modela el recurso con Mongoose, registra eventos con Winston (rotación y retención) y publica la API con OpenAPI / Swagger UI.

## Cómo iniciar

Requisitos: Node.js LTS, npm, MongoDB Community (o Docker), Redis (Linux) o Memurai (Windows), MongoDB Compass (opcional).

```bash
cp .env.example .env
```

### 1. Certificado digital (X509 autofirmado)

**Windows (PowerShell):**

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\generar-certificado.ps1
```

En `.env` descomentar:

```
SSL_PFX_PATH=./certs/server.pfx
SSL_PFX_PASSPHRASE=dev-local-tp2
```

**Linux / WSL:**

```bash
bash scripts/generar-certificado.sh
```

Las claves privadas quedan en `certs/` y **no se entregan**.

### 2. MongoDB

- Windows: instalar [MongoDB Community Server](https://www.mongodb.com/try/download/community) y comprobar el servicio. Compass para inspeccionar la base `taller`.
- Linux: `docker run -d --name taller-mongo -p 27017:27017 mongo:7` y `docker exec taller-mongo mongosh --eval "db.runCommand({ ping: 1 })"`.

`MONGODB_URI` va en `.env`, no en el código. Ejemplo local sin credenciales:

```
MONGODB_URI=mongodb://127.0.0.1:27017/taller
```

Si la URI tuviera usuario y contraseña, **no** van en la entrega. `.env.example` no incluye secretos.

### 3. Redis / Memurai

- Windows: [Memurai](https://www.memurai.com/), `memurai-cli ping` → `PONG`.
- Linux: `docker run -d --name taller-redis -p 6379:6379 redis:7-alpine` y `docker exec taller-redis redis-cli ping`.

### 4. Arranque

```bash
npm install
npm start
```

Queda:

- HTTP  `http://localhost:3000` (se puede apagar con `ENABLE_HTTP=false`)
- HTTPS `https://localhost:3443`
- Swagger UI `https://localhost:3443/api-docs` (también por HTTP)
- OpenAPI JSON `https://localhost:3443/api-docs.json`

cURL contra HTTPS necesita `-k` porque el certificado es autofirmado. Si MongoDB no está, el proceso no arranca. Si Redis no está, arranca igual y el descuento con lock responde 503.

La primera vez, si las colecciones están vacías, se inserta la semilla (3 vehículos y 3 repuestos). Los documentos **no** se recrean al reiniciar Node: eso es justo lo que pide el TP.

## Endpoints

### Vehículos (recurso principal, ahora en MongoDB)

El `id` público es el ObjectId de MongoDB (24 caracteres hex). Un string que no es ObjectId responde **400**. Un ObjectId bien formado que no existe responde **404**. Una patente duplicada responde **409**.

| Método | Endpoint | Acción | Status |
|---|---|---|---|
| GET | `/api/vehiculos` | Listar todos | 200 |
| GET | `/api/vehiculos/:id` | Consultar uno | 200 / 400 / 404 |
| POST | `/api/vehiculos` | Crear | 201 / 400 / 409 |
| PUT | `/api/vehiculos/:id` | Reemplazar | 200 / 400 / 404 / 409 |
| DELETE | `/api/vehiculos/:id` | Eliminar | 204 / 400 / 404 |

Validación (Mongoose): `marca` y `modelo` obligatorios; `anio` entero entre 1900 y año+1; `patente` única, 6–8 caracteres alfanuméricos, se guarda en mayúsculas; `kilometraje` entero ≥ 0.

Semilla (ObjectIds fijos, solo si la colección está vacía):

| id | marca | modelo | patente |
|---|---|---|---|
| `68c000000000000000000001` | Toyota | Corolla | AB123CD |
| `68c000000000000000000002` | Ford | Ranger | AC456EF |
| `68c000000000000000000003` | Volkswagen | Gol | AD789GH |

### Repuestos (TP2, persistidos en MongoDB, lock en Redis)

| Método | Endpoint | Acción | Status |
|---|---|---|---|
| GET | `/api/repuestos` | Listar stock | 200 |
| GET | `/api/repuestos/:id` | Consultar uno | 200 / 400 / 404 |
| GET | `/api/repuestos/:id/lock` | Ver lock en Redis | 200 / 503 |
| POST | `/api/repuestos/:id/descontar-sin-lock` | Descontar **sin** exclusión mutua | 200 / 409 |
| POST | `/api/repuestos/:id/descontar` | Descontar **con** lock Redis | 200 / 409 / 503 |
| POST | `/api/repuestos/reiniciar` | Volver a la semilla | 200 |

Semilla: filtro `68c000000000000000000011` (stock **1**), pastillas `...00012` (4), bujías `...00013` (8).

```bash
curl -k -X POST https://localhost:3443/api/repuestos/68c000000000000000000011/descontar \
  -H "Content-Type: application/json" \
  -d "{\"cantidad\":1}"
```

La sección crítica sigue siendo leer stock → comprobar → restar. El delay `DEMO_DELAY_MS` agranda esa ventana. **No** se usa un update atómico de MongoDB a propósito: el lock de Redis sigue siendo quien serializa. El resultado queda guardado en MongoDB (sobrevive un reinicio de Node).

## Logging (Winston)

Un solo logger en `src/logger.js`, usado por arranque, rutas, Redis y el handler de errores. Niveles:

- **INFO** — arranque, conexiones, CRUD exitoso, requests 2xx.
- **WARN** — 4xx, validación, recurso ocupado, Redis caído al arrancar.
- **ERROR** — 5xx, fallos de Redis/Mongo, lock que no se pudo liberar.

No se registran passphrases, URIs con password (se redactan) ni el contenido de los certificados.

Archivos (rotativos):

- `logs/app-YYYY-MM-DD.log` — aplicación.
- `logs/error-YYYY-MM-DD.log` — solo ERROR.

Rotación por fecha (`YYYY-MM-DD`) y por tamaño (`LOG_MAX_SIZE`, default `5m`). Retención `LOG_MAX_FILES` (default `7d`). Para ver la rotación en un rato corto: `npm run demo:rotacion` (maxSize 1k, maxFiles 3, en `logs/rotacion-demo/`).

## Swagger

- UI: `/api-docs` — Try it out pega contra el mismo servidor.
- JSON: `/api-docs.json`

En el navegador, para no lidiar con el certificado autofirmado, se puede abrir `http://localhost:3000/api-docs`.

## Variables de entorno

Ver `.env.example`. Lo sensible (rutas de certificado, passphrase, URIs) no está hardcodeado.

## Pruebas y respuestas

- `PRUEBAS.md` — cURL y scripts ejecutados contra el servidor real.
- `RESPUESTAS.md` — preguntas de comprensión del enunciado.
- `evidencias/` — salidas crudas de esas corridas.
- `npm run pruebas:https`, `pruebas:crud`, `pruebas:carrera`, `pruebas:persistencia`, `pruebas:swagger`, `demo:rotacion`.

Persistencia (hay que reiniciar Node en el medio):

```bash
npm run pruebas:persistencia crear
# Ctrl+C al servidor, npm start de nuevo
npm run pruebas:persistencia verificar
```

## Idempotencia (se mantiene del TP1)

GET, PUT y DELETE sobre vehículos son idempotentes; POST no lo es. El `id` ahora es un ObjectId, pero el contrato HTTP es el mismo. El descuento de stock **no** es idempotente: dos `POST /descontar` con cantidad 1 bajan el stock dos veces (si hay unidades). El lock no cambia eso; solo evita que esas dos bajadas se pisen.

## Estructura

```
src/
  index.js                 # HTTP + HTTPS, Mongo, Redis, seed, .env
  app.js                   # Express, JSON, Swagger, rutas, 404/400/500
  logger.js                # Winston centralizado + rotación
  mongo.js                 # conexión Mongoose
  redis.js                 # cliente Redis/Memurai
  lock.js                  # adquirir / liberar (propiedad + TTL)
  seed.js                  # semilla si la colección está vacía
  ids.js                   # ObjectIds fijos de la semilla
  openapi.js               # especificación OpenAPI 3
  models/vehiculo.js       # Schema + Model
  models/repuesto.js
  routes/vehiculos.js
  routes/repuestos.js
  utils/
scripts/
  generar-certificado.ps1 / .sh
  pruebas-https.js
  pruebas-crud.js
  pruebas-carrera.js
  pruebas-persistencia.js
  pruebas-swagger.js
  demo-ttl.js
  demo-rotacion.js
certs/                     # se genera local; las claves no van en la entrega
logs/                      # se genera local; no va en la entrega
```

`node_modules`, `.env`, claves privadas y carpetas de logs voluminosas no forman parte de la entrega.
