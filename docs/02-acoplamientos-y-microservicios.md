# Acoplamientos y propuesta de microservicios

**TP5 · torque** · Grupo

Acoplamientos detectados, propuesta de ≥3 microservicios y fichas de cada servicio.

---

## 6. Acoplamientos detectados (≥ 3)

| Caso | Acoplamiento | Problema | Desacople propuesto |
|---|---|---|---|
| 1 | Vehículos y repuestos en el mismo proceso Express y el mismo deploy | Un cambio de stock obliga a redeploy de flota (y viceversa); falla compartida | Servicios independientes con deploys separados bajo el monorepo |
| 2 | Misma instancia Mongo / mismo arranque para ambos dominios | Un schema o seed mal hecho afecta al otro; no hay propiedad clara de datos | Base (o al menos DB name) por servicio; solo el dueño escribe |
| 3 | Descontar stock mezcla validación de negocio + lock Redis + update Mongo en la misma ruta del monolito | La política de concurrencia vive pegada al resto de la API; no se puede escalar ni fallar solo el stock | `inventory-service` dueño exclusivo de stock y del lock |
| 4 | OpenAPI / logger / seed / HTTPS centralizados en un solo `app` | Docs y borde acoplados al monolito | Gateway concentra TLS y docs; cada servicio documenta su contrato |

---

## 7. Propuesta de microservicios (≥ 3)

### 7.1 Ficha — `vehicles-service`

| Elemento | Definición |
|---|---|
| **Nombre** | `vehicles-service` |
| **Responsabilidad** | Ciclo de vida del parque de vehículos del taller |
| **Operaciones** | Listar, obtener, crear, actualizar, eliminar vehículos |
| **Reglas** | Validación de campos; unicidad de patente |
| **Datos propios** | Vehículos (`id`, marca, modelo, año, patente, kilometraje) |
| **Endpoints** | Migran: `GET/POST /api/vehiculos`, `GET/PUT/DELETE /api/vehiculos/:id` |
| **Dependencias** | Ninguna de negocio en esta etapa |
| **Fuera de alcance** | Stock, locks Redis, routing TLS, docs globales |
| **Justificación** | Cohesión alta alrededor de “flota”; no comparte reglas con inventario |

### 7.2 Ficha — `inventory-service`

| Elemento | Definición |
|---|---|
| **Nombre** | `inventory-service` |
| **Responsabilidad** | Disponibilidad y descuento seguro de repuestos |
| **Operaciones** | Consultar stock, descontar, reiniciar demo, diagnosticar lock |
| **Reglas** | Cantidad > 0; rechazo por stock insuficiente; exclusión mutua en descuento seguro |
| **Datos propios** | Repuestos y stock; locks por recurso |
| **Endpoints** | Migran: `/api/repuestos` y subrutas de descuento/lock/reinicio |
| **Dependencias** | Ninguna hacia vehículos en esta etapa |
| **Fuera de alcance** | CRUD de vehículos; terminación TLS del cliente |
| **Justificación** | La concurrencia y el stock son un bounded context distinto al de la flota |

### 7.3 Ficha — `api-gateway`

| Elemento | Definición |
|---|---|
| **Nombre** | `api-gateway` |
| **Responsabilidad** | Punto de entrada único: TLS, enrutamiento, documentación agregada |
| **Operaciones** | Proxy/route a vehículos e inventario; `/api-docs`; health |
| **Reglas** | Solo de borde (rutas, timeouts); **no** duplica patente ni stock |
| **Datos propios** | Ninguno de negocio (config de rutas / certs) |
| **Endpoints** | Públicos actuales reexpuestos; internos apuntan a cada servicio |
| **Dependencias** | `vehicles-service`, `inventory-service` (HTTP) |
| **Fuera de alcance** | Persistencia de vehículos o stock |
| **Justificación** | Evita que el cliente conozca N bases URL; concentra HTTPS y Swagger |

### 7.4 Tabla general

| Microservicio | Responsabilidad | Datos | Funciones principales | Dependencias |
|---|---|---|---|---|
| `vehicles-service` | Parque de vehículos | `vehiculos` | CRUD + unicidad patente | — |
| `inventory-service` | Stock de repuestos | `repuestos`, locks | Consulta + descuento concurrente | Redis (infra) |
| `api-gateway` | Acceso unificado | config/certs | Route, TLS, docs | vehicles, inventory |

---

