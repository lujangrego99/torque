# Pruebas — TP N° 3

Servidor: `https://localhost:3443` (también `http://localhost:3000`)  
Swagger UI: `http://localhost:3000/api-docs`  
Herramientas: cURL, scripts de `scripts/`, mongosh, Redis CLI, Swagger Try it out  
Certificado: X509 autofirmado `CN=localhost` (`curl -k`)

Las salidas crudas están en `evidencias/`.

Al arrancar con colecciones vacías se insertan 3 vehículos y 3 repuestos. **No** se recrean al reiniciar Node.

---

## Parte I — Persistencia y modelado

### 1. MongoDB disponible y la API conectada

`docker exec taller-mongo mongosh --eval "db.runCommand({ ping: 1 })"` → `{ ok: 1 }`.

Log de arranque:

```
MongoDB conectado en mongodb://127.0.0.1:27017/taller (db=taller)
Seed de vehículos insertado (3 documentos).
```

`MONGODB_URI` está en `.env` / `.env.example`, no en el código.

### 2. CRUD sobre documentos persistidos

`npm run pruebas:crud` (`evidencias/06-crud.txt`):

| Caso | Status |
|---|---|
| GET `/api/vehiculos` | 200, 3 seeds |
| GET ObjectId del Corolla | 200 |
| GET `no-es-un-objectid` | **400** |
| GET `aaaaaaaaaaaaaaaaaaaaaaaa` | **404** |
| POST Honda Civic | **201** |
| POST misma patente | **409** |
| POST marca vacía / año 1800 / patente `??` / km −1 | **400** (el estado no cambia) |
| PUT kilometraje | 200 |
| DELETE | **204** |
| DELETE otra vez | **404** |

`evidencias/07-validacion-400.txt` y `08-id-400-vs-404.txt` son los mismos casos con headers HTTP.

### 3. Persistencia después de reiniciar Node

```bash
npm run pruebas:persistencia crear
# Ctrl+C al servidor, npm start
npm run pruebas:persistencia verificar
```

Creado: Chevrolet Onix `id=6a9b58d6624713f4ea21b79c` patente `PPLUL2G` (201).  
Después del reinicio: GET del mismo id → **200**, mismos datos. Seed omitido (`la colección ya tiene documentos`).  
mongosh: el documento sigue en `taller.vehiculos` (`evidencias/15b-persistencia-verificar.txt`, `15c-mongo-despues-reinicio.txt`, `10-mongosh.txt`).

---

## Parte II — Logging y rotación

`src/logger.js` escribe `logs/app-YYYY-MM-DD.log` y `logs/error-YYYY-MM-DD.log`.

Extracto (`evidencias/16-logs-extracto.txt`):

- **INFO** — `MongoDB conectado`, `Vehículo creado id=... patente=ZZNLT9QQ`, `GET /api/vehiculos 200`.
- **WARN** — `identificador inválido` (400), `no encontrado` (404), `conflicto de unicidad` (409), validación rechazada.
- **ERROR** — `Evento ERROR de evidencia` (`node scripts/forzar-error.js`) y el fallo de seed de la primera corrida (max de `anio`), ambos en `error-2026-09-04.log`.

Rotación (`npm run demo:rotacion`, `evidencias/12-rotacion.txt`): `maxSize=1k` genera `app-2026-09-04.log` + `.1` … `.9` de ~1 KB cada uno. En producción: `LOG_MAX_SIZE=5m`, `LOG_MAX_FILES=7d`.

No se loguean passphrases ni URIs con password (se redactan).

---

## Parte III — OpenAPI / Swagger

```bash
npm run pruebas:swagger
```

- `/api-docs.json` → OpenAPI **3.0.3**, title `API REST de taller`, paths de vehículos y repuestos (`evidencias/05-swagger.txt`).
- `/api-docs` → HTML Swagger UI (`<title>Taller API — Swagger</title>`).

Try it out contra `http://localhost:3000` (`evidencias/19` a `23`, capturas):

| Operación | Código visible en la UI |
|---|---|
| GET `/api/vehiculos` | 200, listado con ObjectIds |
| POST Civic `SW123AG` | 201 |
| POST inválido | 400, detalles de Mongoose |
| GET id `aaaaaaaaaaaaaaaaaaaaaaaa` | 404 |

---

## Parte IV — Concurrencia (continúa el TP2, ahora persistida)

`npm run pruebas:carrera` (`evidencias/14-carrera.txt`). Filtro `68c000000000000000000011`, stock inicial 1.

**Sin lock:** A 200 stock 0, B 200 stock **−1**. Duración ~2 s. Oversell.

**Con lock Redis:** A 200 stock 0 + `lock:repuesto:68c000000000000000000011`, B **409 Recurso ocupado**. Estado final **0**. Ese 0 es el documento en MongoDB (`evidencias/17-lock-y-mongo.txt`).

**Granularidad:** filtro y pastillas a la vez, los dos 200, ~2008 ms (no ~4000). Locks distintos.

**Lock vivo** (`evidencias/18-redis-lock-vivo.txt`): durante el descontar, `GET` = uuid y `PTTL` ≈ 7476 ms. Después, `PTTL -2`.

HTTPS del TP2 se mantiene: `curl -vk https://localhost:3443/` → TLSv1.3, certificado autofirmado CN=localhost, 200 (`evidencias/01-https-root.txt`, `03-certificado.txt`, `04-pruebas-https.txt`).

---

## Cómo reproducir

```bash
cp .env.example .env
bash scripts/generar-certificado.sh   # o el .ps1 en Windows
# MongoDB y Redis/Memurai arriba (ver README)
npm install
npm start
npm run pruebas:https
npm run pruebas:crud
npm run pruebas:carrera
npm run pruebas:swagger
npm run demo:rotacion
npm run pruebas:persistencia crear
# reiniciar Node
npm run pruebas:persistencia verificar
```
