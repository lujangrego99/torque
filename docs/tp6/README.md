# TP6 — Implementación de microservicios y Docker

| Documento | Contenido | Autor |
|---|---|---|
| [01-plan-implementacion.md](01-plan-implementacion.md) | Hito 1: matriz servicio/endpoints/datos/dependencias, dueño de cada endpoint, cambios vs TP5, reparto | Gregorio Luján |
| [casos-de-uso.md](casos-de-uso.md) | Recorrido final de cada caso de uso (§7) | Manuel Moya |
| [semantica-errores.md](semantica-errores.md) | Errores funcionales vs. de infraestructura, timeouts (§15, §15.2) | Jan Lahorca |
| [fallo-parcial.md](fallo-parcial.md) | Análisis del fallo parcial de "crear orden" (§15.3) | Agustín Martínez |
| [../../README.md](../../README.md) | Cómo levantar, puertos, variables, volúmenes, pruebas | Grupo |

## Evidencias (`evidencias/`)

Las genera `bash scripts/pruebas-tp6.sh` (y `scripts/prueba-local.sh` para la 13).
Cada archivo muestra el **comando** y su **salida real**, para poder repetirlo.

| Archivo | Qué demuestra |
|---|---|
| `00-docker.txt` | versión de Docker / Compose, `docker info`, `hello-world` (PC de Gregorio, WSL) |
| `docker-manu.txt` · `docker-jan.txt` · `docker-agus.txt` | ídem en la PC de cada integrante |
| `01-build-individual.txt` | cada Dockerfile construye su imagen; una imagen sola sin base arranca, responde `/health` 503 y reintenta |
| `02-compose-up.txt` | `docker compose config` + `up --build --wait`: 8 contenedores `healthy`; redes y volúmenes |
| `03-health.txt` | `/health` de cada servicio y la vista agregada del gateway |
| `04-crud.txt` | CRUD de vehículos (201/200/409/400/404/204) y stock (carrera sin lock → -1; con lock → 409 + stock 0) |
| `05-comunicacion.txt` | orden de trabajo: workorders → vehicles + inventory por HTTP, mismo `rid` en los 4 logs; 404 funcionales propagados |
| `06-propiedad-datos.txt` | cada base tiene solo su colección; cada servicio solo tiene la URI de su base; la orden guarda ids |
| `07-persistencia.txt` | `down` (sin `-v`) + `up`: el vehículo creado sigue |
| `08-fallo-dependencia.txt` | se detiene inventory: 503 controlado (`dns`), el resto sigue, `/health/servicios` lo muestra; al volver, la orden se crea. Extra: base de vehicles caída y recuperada |
| `09-fallo-parcial.txt` | orden FALLIDA con bujías ya descontadas (`requiereCompensacion: true`); variante timeout → `INCIERTO` pero aplicado |
| `10-logs.txt` | `docker compose logs` con servicio, nivel, endpoint, status, rid |
| `11-swagger.txt` | Swagger UI del gateway y los 4 specs con sus rutas |
| `12-datos-prueba.txt` | reset de stock y reset total (`down -v`) → estado semilla conocido |
| `13-ejecucion-local.txt` | los 4 servicios con Node y variables locales (mismo código) |
