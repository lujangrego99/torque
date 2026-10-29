# torque

Gestión de taller mecánico. Es el proyecto grupal de **Programación Distribuida** (UCH).

Es un repositorio **único y evolutivo**: no se crea un repo nuevo por entrega, se marca con tags (`tp5-entrega`, `tp6-entrega`, …).

| TP | Qué se hizo | Dónde |
|---|---|---|
| TP5 | Análisis y diseño de microservicios | `docs/arquitectura.md`, `docs/01…03`, `docs/diagrama-arquitectura.md` |
| **TP6** | **Implementación de los microservicios + Docker / Docker Compose** | `services/`, `docker-compose.yml`, [`docs/tp6/`](docs/tp6/README.md) |

## Integrantes

| Nombre | GitHub | Aporte TP6 |
|---|---|---|
| Gregorio Luján | [@lujangrego99](https://github.com/lujangrego99) | plan (Hito 1), `api-gateway`, Docker Compose, scripts de prueba, documentación integrada |
| Manuel Moya | [@ManusMoya](https://github.com/ManusMoya) | `vehicles-service`, casos de uso |
| Jan Lahorca | [@janlahorca](https://github.com/janlahorca) | `inventory-service`, semántica de errores |
| Agustín Martínez | [@AgustinEMCE](https://github.com/AgustinEMCE) | `workorders-service`, análisis de fallo parcial |

Docentes colaboradores: `alvarezadriel@uch.edu.ar`, `cortezedgardo@uch.edu.ar`.

---

## 1. Arquitectura implementada

```mermaid
flowchart LR
  Client[Cliente / cURL / Swagger]
  subgraph edge [red edge]
    GW["api-gateway<br/>:3000 HTTP · :3443 HTTPS"]
  end
  subgraph backend [red backend — sin puertos publicados]
    VS[vehicles-service]
    IS[inventory-service]
    WS[workorders-service]
    M1[(vehicles-db)]
    M2[(inventory-db)]
    M3[(workorders-db)]
    R[(redis)]
  end
  Client --> GW
  GW -->|/api/vehiculos| VS
  GW -->|/api/repuestos| IS
  GW -->|/api/ordenes| WS
  WS -->|HTTP| VS
  WS -->|HTTP| IS
  VS --> M1
  IS --> M2
  IS --> R
  WS --> M3
```

| Servicio | Responsabilidad | Datos propios | Habla con |
|---|---|---|---|
| `api-gateway` | Punto de entrada único: HTTPS, enrutamiento por prefijo, Swagger agregado | — | los 3 servicios |
| `vehicles-service` | Parque de vehículos: CRUD y patente única | `vehicles-db` → `vehiculos` | — |
| `inventory-service` | Stock de repuestos y descuento con lock Redis | `inventory-db` → `repuestos` · `redis` (locks) | — |
| `workorders-service` | Órdenes de trabajo: valida el vehículo y descuenta repuestos | `workorders-db` → `ordenes` | vehicles, inventory |

Ningún servicio accede a la base de otro. Detalle: [Hito 1 — plan de implementación](docs/tp6/01-plan-implementacion.md).

### Cambios respecto del TP5

- **Nuevo `workorders-service`.** El TP5 ya lo dejaba previsto (§11: "un cuarto bounded context de órdenes de trabajo"). Hace falta para tener una operación que cambie estado en dos servicios: es la comunicación real y el fallo parcial que pide el TP6.
- **Una instancia MongoDB por servicio**, en lugar de compartir una instancia con bases separadas.
- **HTTPS solo en el gateway.** Entre contenedores se usa HTTP.
- **Logs a stdout** en lugar de archivos rotativos.
- `monolito/` (TP3) queda como referencia histórica y no forma parte del Compose.

Justificación completa: [01-plan-implementacion.md §4](docs/tp6/01-plan-implementacion.md#4-cambios-respecto-del-tp5-y-por-qué).

---

## 2. Requisitos

- **Docker** con **Docker Compose v2**: Docker Desktop con backend WSL 2 en Windows, o Docker Engine con el plugin compose en Linux.
- `bash` + `curl` para los scripts de prueba (Linux, WSL o Git Bash).
- Opcional, para correr sin Docker: Node.js ≥ 20, MongoDB y Redis o Memurai.

Verificación de Docker:

```bash
wsl --status                # solo Windows
docker --version
docker compose version
docker info
docker run --rm hello-world
```

Evidencias de cada integrante: `docs/tp6/evidencias/docker-*.txt`.

## 3. Levantar la solución (un solo comando)

```bash
git clone https://github.com/lujangrego99/torque.git
cd torque
cp .env.example .env                                  # opcional: todas las variables tienen valor por defecto
bash services/api-gateway/scripts/generar-certificado.sh   # opcional: habilita HTTPS en :3443
docker compose up --build
```

Otros comandos útiles:

```bash
docker compose config          # valida el archivo
docker compose ps              # estado + (healthy)
docker compose logs -f         # logs de todos   ·  docker compose logs -f workorders-service
docker compose down            # detiene y CONSERVA los datos
docker compose down -v         # detiene y BORRA los volúmenes (estado inicial)
```

## 4. Puertos, URLs y nombres internos

Solo el gateway publica puertos hacia la PC:

| Desde la PC | URL |
|---|---|
| API (HTTP) | `http://localhost:3000/api/...` |
| API (HTTPS, si hay certificado) | `https://localhost:3443/api/...` (`curl -k`) |
| **Swagger** (los 4 contratos, con selector) | `http://localhost:3000/api-docs` |
| Salud del gateway | `http://localhost:3000/health` |
| Salud de todos los servicios | `http://localhost:3000/health/servicios` |

Dentro de la red de Compose cada contenedor se alcanza por **nombre de servicio + puerto interno**. Nunca se usa `localhost` ni una IP fija:

| Origen | Destino | URL interna |
|---|---|---|
| api-gateway | vehicles-service | `http://vehicles-service:3000` |
| api-gateway | inventory-service | `http://inventory-service:3000` |
| api-gateway | workorders-service | `http://workorders-service:3000` |
| workorders-service | vehicles-service / inventory-service | `http://vehicles-service:3000` · `http://inventory-service:3000` |
| vehicles-service | su base | `mongodb://vehicles-db:27017/vehicles` |
| inventory-service | su base / Redis | `mongodb://inventory-db:27017/inventory` · `redis://redis:6379` |
| workorders-service | su base | `mongodb://workorders-db:27017/workorders` |

Cada servicio expone `GET /health` y `GET /api-docs` en su puerto interno 3000. Desde la PC se ven a través del gateway (`/health/servicios`, `/api-docs`).

## 5. Variables de entorno

| Archivo | Para qué |
|---|---|
| `.env.example` (raíz) | variables opcionales de `docker-compose.yml`: puertos publicados, timeouts, lock |
| `services/<servicio>/.env.example` | variables de cada servicio para correrlo con Node, con los valores locales |

Ningún `.env` real, clave ni certificado se versiona (`.gitignore`), y tampoco entra en las imágenes (`.dockerignore`).

### Local vs. Docker Compose: solo cambia la configuración

| Variable | Ejecución local (Node) | Docker Compose |
|---|---|---|
| `PORT` | 3001 / 3002 / 3003 / 3000 | 3000 en todos (puerto interno) |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/<base>` | `mongodb://<servicio>-db:27017/<base>` |
| `REDIS_URL` | `redis://127.0.0.1:6379` (Redis o Memurai) | `redis://redis:6379` |
| `*_SERVICE_URL` | `http://localhost:300x` | `http://<servicio>:3000` |
| `SSL_*_PATH` | `./certs/...` | `/app/certs/...` (volumen) |

Con `bash scripts/prueba-local.sh` se corren los 4 servicios con Node, con el mismo código, cambiando solo esas variables. Evidencia en `docs/tp6/evidencias/13-ejecucion-local.txt`.

## 6. Inicio y disponibilidad de dependencias

- **Bases y Redis** tienen healthcheck (`mongosh ping` / `redis-cli ping`). Cada servicio espera a **su** base con `depends_on: condition: service_healthy`.
- **Cada microservicio** tiene healthcheck en Compose (y en su Dockerfile) contra su `/health`. Se ejecuta con `node -e "fetch(...)"`, que ya viene en la imagen, sin depender de curl ni wget.
- `/health` responde **200 solo si el servicio puede atender**, es decir, si su base está conectada. Si el proceso está vivo pero sin base, responde **503** (`degraded`). Así se distingue un contenedor iniciado de un servicio disponible.
- Las dependencias **entre servicios** usan solo `service_started`: si `inventory-service` está caído, el gateway y workorders arrancan igual y responden 503 controlado.
- **La aplicación no confía en el orden de inicio.** Abre el puerto enseguida y conecta a Mongo con reintentos (`MONGO_RETRY_MS`). Redis reconecta solo. `bufferCommands=false` hace que, sin base, la consulta falle en el momento (503) en vez de quedar colgada.

## 7. Volúmenes y persistencia

| Volumen | Montado en | Contenido |
|---|---|---|
| `torque_vehicles-data` | `vehicles-db:/data/db` | vehículos |
| `torque_inventory-data` | `inventory-db:/data/db` | repuestos |
| `torque_workorders-data` | `workorders-db:/data/db` | órdenes |

Redis no tiene volumen a propósito: los locks son efímeros (TTL) y no hay nada que conservar.

- `docker compose down` elimina contenedores y red, pero **conserva los volúmenes**. Al hacer `up` de nuevo, los datos siguen ahí y el seed se omite porque las colecciones no están vacías.
- `docker compose down -v` **borra los volúmenes**. Al hacer `up`, se vuelve a sembrar el estado inicial. Usarlo solo para reiniciar el laboratorio a propósito.

Prueba: `bash scripts/pruebas-tp6.sh 07-persistencia`.

## 8. Logs

Todos los servicios loguean a stdout con el formato `timestamp [NIVEL] [servicio] mensaje`, con método, ruta, status, duración y `rid` (request id). El gateway genera el `x-request-id` y lo propaga, así que una orden se sigue de punta a punta:

```bash
docker compose logs -f
docker compose logs workorders-service | grep ERROR
docker compose logs | grep <rid>
```

## 9. Comportamiento ante una dependencia caída

| Caída | Efecto |
|---|---|
| `inventory-service` | `/api/repuestos` → **503** del gateway (`causa: dns`). `POST /api/ordenes` → **503** de workorders, sin crear orden. Vehículos y consulta de órdenes **siguen funcionando**. |
| `vehicles-service` | `/api/vehiculos` → 503. Las órdenes nuevas → 503 (no se puede validar el vehículo). |
| `vehicles-db` / `inventory-db` / `workorders-db` | el servicio dueño responde 503 en sus operaciones y `/health` = 503. Se recupera solo al volver la base. |
| `redis` | `POST /api/repuestos/:id/descontar` → 503. Las consultas de stock siguen. `/health` de inventory = `degraded`. |

Los errores **funcionales** remotos (404, 409) no se convierten en 503: se propagan. Tabla completa: [semantica-errores.md](docs/tp6/semantica-errores.md).

## 10. Fallo parcial (operación distribuida)

Crear una orden con varios repuestos descuenta stock **ítem por ítem** en inventory-service. Si el ítem 2 falla (sin stock, o timeout), el ítem 1 ya quedó descontado. La orden queda `FALLIDA` con el estado de cada ítem y `requiereCompensacion: true`, y el log marca `FALLO PARCIAL`. Un timeout deja el ítem `INCIERTO`, porque inventory pudo haberlo aplicado.

Análisis completo, cambios de estado, qué pasa en cada etapa y qué haría falta para compensar: [fallo-parcial.md](docs/tp6/fallo-parcial.md).

## 11. Datos de prueba (estado inicial conocido)

| Seed | Ids fijos |
|---|---|
| Vehículos | Corolla `68c000000000000000000001` · Ranger `…002` · Gol `…003` |
| Repuestos | Filtro `68c000000000000000000011` (stock 1) · Pastillas `…012` (4) · Bujías `…013` (8) |
| Órdenes | ninguna |

```bash
bash scripts/reset-datos.sh          # solo restaura el stock (POST /api/repuestos/reiniciar)
bash scripts/reset-datos.sh --todo   # down -v + up: todo vuelve a la semilla
```

## 12. Pruebas

```bash
bash scripts/pruebas-tp6.sh                 # todas (≈ 3 min). Deja la salida en docs/tp6/evidencias/
bash scripts/pruebas-tp6.sh 08-fallo        # solo una sección
bash scripts/prueba-local.sh                # mismos servicios con Node, sin Docker para las apps
```

| Prueba (TP6 §18) | Sección / evidencia |
|---|---|
| Build individual | `01-build-individual` |
| Inicio con Compose | `02-compose-up` |
| Health | `03-health` |
| CRUD / negocio | `04-crud` |
| Comunicación entre servicios | `05-comunicacion` |
| Propiedad de datos | `06-propiedad-datos` |
| Persistencia | `07-persistencia` |
| Fallo de dependencia | `08-fallo-dependencia` |
| Fallo parcial | `09-fallo-parcial` + [análisis](docs/tp6/fallo-parcial.md) |
| Logs | `10-logs` |
| Swagger | `11-swagger` |
| Datos de prueba | `12-datos-prueba` |
| Configuración por entorno | `13-ejecucion-local` |
| Startup / disponibilidad | `01` (imagen sola sin base → 503 y reintento) · `08` (base caída y recuperación) |

Índice de evidencias: [docs/tp6/README.md](docs/tp6/README.md).

## 13. Estructura del repositorio

```
torque/
├── docker-compose.yml          solución integrada
├── .env.example                variables de Compose (opcionales)
├── services/
│   ├── api-gateway/            Dockerfile · .dockerignore · .env.example · README · src/
│   ├── vehicles-service/       ídem
│   ├── inventory-service/      ídem
│   └── workorders-service/     ídem
├── scripts/                    pruebas-tp6.sh · prueba-local.sh · reset-datos.sh
├── docs/
│   ├── tp6/                    plan, casos de uso, errores, fallo parcial, evidencias
│   └── (TP5)                   arquitectura, inventario, acoplamientos, diagrama
└── monolito/                   TP3 (referencia histórica, no se usa en Compose)
```

Cada servicio separa `routes/` → `controllers/` → `services/` (negocio) → `models/` / `clients/` (persistencia propia / otros servicios) → `config/`.

## Flujo de Git

- Rama principal: `main`. Todo entra por **Pull Request** desde ramas `feature/…`, `docs/…` o `fix/…`.
- Entrega TP6: tag `tp6-entrega` sobre el `main` integrado y probado.
