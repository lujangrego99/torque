# Correcciones de la primera revisión

Implementación de los requisitos redefinidos después de la primera revisión
(documento *"Torque: requisitos redefinidos tras la primera revisión"*, 6/11/2026).
Base: `main` en `b203d70` (tag `tp7-entrega`).

Todo se prueba con `scripts/pruebas-correcciones.sh`. La salida de cada sección
queda en [`evidencias/`](evidencias/).

```bash
bash scripts/generar-env.sh
LAB_ENDPOINTS=true docker compose up --build -d --wait   # la carrera de stock usa el laboratorio
bash scripts/pruebas-correcciones.sh                     # todas las secciones (≈ 2 min)
bash scripts/pruebas-correcciones.sh 06-                 # una sola
```

## 1. Qué cambió, requisito por requisito

| # | Requisito | Antes | Ahora | Dónde | Evidencia |
|---|---|---|---|---|---|
| 1 | Alta de usuarios | `POST /api/auth/register` público, siempre MECANICO | **Alta administrada:** `POST /api/auth/usuarios`, solo ADMIN. `/register` ya no existe (404). Se mantienen la validación, el 409 por duplicado y la respuesta sin contraseña ni hash | `auth-service` | [01](evidencias/01-alta-administrada.txt) |
| 3 | Sesión | Access token de 15 min, sin renovación | Access token de **5 min** + **refresh token** rotativo (`/refresh`). La sesión vence a los **15 min sin renovar**. `/logout` revoca la renovación | `auth-service` (`sesiones`) | [02](evidencias/02-sesion-renovable.txt) |
| 4 | Vehículos | Cualquiera crea, el admin borra aunque haya órdenes, sin dueño | **Dueño obligatorio** (nombre y teléfono), **duplicado detectado** (409 con el vehículo existente; la orden se puede crear por patente), **baja lógica** (`activo:false`, quién, cuándo, motivo), **historial** del auto visible para cualquier mecánico | `vehicles-service`, `workorders-service` | [03](evidencias/03-vehiculos.txt) · [09](evidencias/09-historial-del-vehiculo.txt) |
| 5 | Consulta de stock | Pública | Requiere estar autenticado | `inventory-service` | [04](evidencias/04-stock-autenticado.txt) |
| 6 | Alta de repuestos | No existía | `POST /api/repuestos`, solo ADMIN, código único (409). El stock inicial entra como INGRESO | `inventory-service` | [05](evidencias/05-inventario-alta-ingreso-ajuste.txt) |
| 7 | Ingreso y ajuste | No existían | Dos operaciones separadas, solo ADMIN: `/:id/ingreso` (suma) y `/:id/ajuste` (con signo, **exige motivo**, no deja stock negativo) | `inventory-service` | [05](evidencias/05-inventario-alta-ingreso-ajuste.txt) |
| 9 | Historial de stock | No existía | **Libro de movimientos** (`movimientos`): tipo, cantidad, saldo anterior y resultante, usuario, fecha, motivo y **orden asociada**. `GET /api/repuestos/movimientos` | `inventory-service` | [05](evidencias/05-inventario-alta-ingreso-ajuste.txt) · [06](evidencias/06-cancelacion-y-reposicion.txt) |
| 10 | Reposición | Orden fallida con `requiereCompensacion`, nadie reponía | **Automática** al cancelar y al fallar, con un **contramovimiento** REPOSICION ligado a la orden (no rollback). Idempotente | `inventory-service` + `workorders-service` | [06](evidencias/06-cancelacion-y-reposicion.txt) · [07](evidencias/07-fallo-parcial-reposicion-automatica.txt) · [11](evidencias/11-reposicion-con-inventory-caido.txt) |
| 13 | Estados de la orden | PENDIENTE, CONFIRMADA, FALLIDA | PENDIENTE, **EN_PROCESO**, **FINALIZADA**, **CANCELADA**, FALLIDA, con historial de transiciones | `workorders-service` | [08](evidencias/08-estados-de-la-orden.txt) |
| 14 | Cancelar | No existía | `POST /api/ordenes/:id/cancelar`: dueño o ADMIN, hasta que se finalice, **con motivo, quién y cuándo**. La orden queda como CANCELADA | `workorders-service` | [06](evidencias/06-cancelacion-y-reposicion.txt) |
| 16 | Endpoints de demostración | Siempre activos (ADMIN) | Solo existen con **`LAB_ENDPOINTS=true`**. Sin la variable: 404 y fuera de Swagger | `inventory-service` | [10](evidencias/10-carrera-y-laboratorio.txt) |
| NF | Observabilidad | Logs con duración y `rid` | Además, **`GET /metrics`** en cada servicio (pedidos, errores, p50/p95/p99, por ruta) y **`/metrics/servicios`** en el gateway con el resumen comparativo | los 5 servicios + gateway | [12](evidencias/12-metricas.txt) |

Sin cambios (sección 5 del documento): roles (2), lock de Redis (8, ahora además
registra el movimiento), crear órdenes a nombre del creador (11), cada mecánico
ve sus órdenes (12). El requisito 15 queda cubierto por el 10.

## 2. Matriz de acceso actualizada

| Endpoint | Sin token | MECANICO | ADMIN |
|---|---|---|---|
| `POST /api/auth/login` · `/refresh` · `/logout` | ✔ | ✔ | ✔ |
| `POST /api/auth/usuarios` (alta) · `GET/PATCH /api/auth/usuarios…` | 401 | 403 | ✔ |
| `GET /api/repuestos…` (stock) | **401** | ✔ | ✔ |
| `POST /api/repuestos` · `/:id/ingreso` · `/:id/ajuste` | 401 | 403 | ✔ |
| `POST /api/repuestos/:id/descontar` (lo usa workorders) | 401 | ✔ | ✔ |
| `POST /api/repuestos/reposiciones` | 401 | ✔ si hizo los descuentos | ✔ |
| `GET /api/repuestos/movimientos` | 401 | los que generó | todos |
| `reiniciar` · `/:id/lock` · `/:id/descontar-sin-lock` | **404 sin `LAB_ENDPOINTS=true`**; con la variable: 401 / 403 / ✔ | | |
| `GET/POST/PUT /api/vehiculos…` · `/patente/:p` | 401 | ✔ | ✔ |
| `DELETE /api/vehiculos/:id` (baja lógica) · `/:id/reactivar` | 401 | 403 | ✔ |
| `POST /api/ordenes` | 401 | ✔ | ✔ |
| `GET /api/ordenes` · `GET/PATCH /:id` · `/:id/cancelar` · `/:id/finalizar` · `/:id/reponer` | 401 | **solo las propias** (ajena → 403) | todas |
| `GET /api/ordenes/vehiculo/:vehiculoId` (historial del auto) | 401 | todas, solo lectura (`propia` marca las suyas) | todas |
| `GET /health…` · `GET /metrics…` | ✔ (operativos, sin datos del negocio) | | |

## 3. Decisiones de diseño

### 3.1 Sesión renovable (requisito 3)

- **Access token** (JWT HS256, 5 min): no cambia cómo se valida. Cada servicio
  lo verifica con la firma, sin consultar a auth. Suma el claim `sid` (sesión).
- **Refresh token**: valor aleatorio opaco (no es un JWT) que solo sirve contra
  `auth-service`. En `auth-db.sesiones` se guarda **su hash SHA-256**, nunca el valor.
- **Rotación**: cada `/refresh` entrega un refresh nuevo y el anterior deja de
  servir. La rotación es atómica: si llegan dos renovaciones con el mismo
  token, gana una sola.
- **Inactividad**: cada renovación corre el vencimiento (`SESSION_IDLE`,
  15 min). Si el cliente deja de usar la app, nadie renueva y la sesión vence.
- **Reutilización**: presentar un refresh ya rotado indica que pudo haber sido
  robado. Se revoca la sesión entera, y tanto el ladrón como el usuario tienen
  que volver a iniciar sesión.
- **Logout** y **deshabilitar un usuario** revocan la renovación. El access
  token ya emitido sigue valiendo hasta su `exp` (≤ 5 min). Ese es el costo de
  no consultar a auth en cada pedido, y por eso el access token es corto.

### 3.2 Libro de movimientos y reposición (requisitos 9 y 10)

- Cada cambio de stock pasa por el **lock de Redis** del repuesto y deja una
  línea en `movimientos` con el saldo real que quedó. Si la línea no se puede
  guardar, se revierte el `$inc`.
- El descuento de una orden lleva **`ordenId` obligatorio**. Un índice único
  `(ordenId, repuestoId, tipo)` garantiza que una orden descuente y reponga cada
  repuesto **una sola vez**. Un reintento devuelve el movimiento existente
  (`repetido: true`) en lugar de descontar de nuevo.
- **Reposición** (`POST /api/repuestos/reposiciones`): inventory devuelve lo que
  **su libro** registra como descontado por la orden, no lo que cree la orden.
  Pedirla dos veces no suma dos veces (`YA_REPUESTO`).
- Si inventory está caído cuando se cancela, la orden queda **CANCELADA con
  `reposicion.estado = PENDIENTE`** y se reintenta con
  `POST /api/ordenes/:id/reponer`. El stock no se pierde, porque el descuento
  sigue en el libro ([evidencia 11](evidencias/11-reposicion-con-inventory-caido.txt)).

### 3.3 Descuento incierto (lo que quedaba "pendiente de verificar")

Un timeout deja el ítem `INCIERTO`: el descuento pudo haberse aplicado o no. Se
resuelve con el libro:

1. Al reponer, workorders incluye los ítems inciertos (`repuestoIds`).
2. inventory toma el lock del repuesto y consulta el libro por `ordenId`. Si el
   descuento se aplicó, lo devuelve. Si no, deja una REPOSICION de 0 unidades.
3. Esa REPOSICION de 0 funciona como cierre: si el descuento tardío llega
   después, inventory lo rechaza con **409 "Orden cerrada"**
   ([evidencia 10](evidencias/10-carrera-y-laboratorio.txt)).
4. La orden marca el ítem `REPUESTO` o `NO_APLICADO`, según lo que diga el libro.

### 3.4 Ciclo de vida de la orden (requisitos 13 y 14)

```
PENDIENTE ──(repuestos descontados)──▶ EN_PROCESO ──(finalizar)──▶ FINALIZADA
    │                                      │
    ├──(falla un descuento)──▶ FALLIDA ⟲   └──(cancelar)──▶ CANCELADA ⟲
    └──(cancelar)──▶ CANCELADA ⟲                    ⟲ = reposición automática
```

- Las transiciones son **atómicas y condicionales**
  (`findOneAndUpdate({estado: …})`). Dos cancelaciones simultáneas, o una
  cancelación y una finalización, no pisan una a la otra.
- Mientras la orden se está creando, el avance se guarda solo si sigue
  PENDIENTE, así la creación no pisa una cancelación que llegó en el medio.
- `historial` registra cada transición con fecha, usuario y detalle. Una orden
  FINALIZADA no se cancela ni se edita: los repuestos se usaron en el auto.

### 3.5 Vehículos (requisito 4)

- La patente se normaliza (mayúsculas, sin espacios ni guiones). Si ya existe,
  el alta responde **409 con `vehiculoExistente`**, y la orden nueva se crea con
  `{"patente": "AB123CD"}`.
- La **baja lógica** conserva el documento. `GET /api/vehiculos` lista solo los
  activos (`?incluirInactivos=true` lista todos). `GET /:id` lo devuelve igual,
  porque las órdenes viejas lo referencian. Un auto inactivo no admite órdenes
  nuevas (409) ni modificaciones, y un ADMIN puede reactivarlo.

### 3.6 Endpoints de laboratorio (requisito 16)

`reiniciar`, `/:id/lock` y `/:id/descontar-sin-lock` se registran **solo si
`LAB_ENDPOINTS=true`**. Por defecto (`.env.example`, Compose) están apagados: la
ruta no existe (404) y tampoco aparece en el contrato OpenAPI. `reiniciar`
ahora también restaura el libro de movimientos.

### 3.7 Métricas y cuello de botella (no funcional)

- `src/config/metricas.js` (mismo archivo en cada servicio) cuenta en memoria
  pedidos, errores 4xx/5xx, pedidos en curso y tiempos (promedio, p50, p95, p99,
  máx.), en total y **por ruta plantilla** (`POST /api/ordenes/:id/cancelar`, no
  por id).
- `GET /metrics` (JSON) o `GET /metrics?formato=prometheus` (texto que leería un
  recolector externo).
- El gateway agrega todo en **`GET /metrics/servicios`**, con un resumen
  ordenado por p95. **Cómo se detecta un cuello de botella:** el servicio con
  el p95 más alto, o con pedidos en curso que crecen, es el lento. Su detalle por
  ruta dice qué operación. En la [evidencia 12](evidencias/12-metricas.txt),
  workorders es el más lento porque espera en serie los descuentos de inventory,
  cada uno retenido `DEMO_DELAY_MS` dentro del lock.
- Fuera de alcance: centralizar logs y métricas. Se haría con un recolector
  (Prometheus leyendo `/metrics?formato=prometheus`, Loki/ELK leyendo stdout de
  los contenedores) sin cambiar el código.

### 3.8 Escalabilidad (decisión provisoria 3)

Se explica, no se demuestra con réplicas. Los servicios no guardan estado en
memoria salvo las métricas, que son por proceso. Se escalan **horizontalmente**
detrás del gateway (`docker compose up --scale vehicles-service=3`, con el DNS
de Compose repartiendo). El lock de stock ya es distribuido (Redis), así que
dos réplicas de inventory se excluyen igual. El refresh token vive en
`auth-db`, no en memoria, así que cualquier réplica de auth lo puede renovar.

## 4. Decisiones provisorias (sección 8 del documento)

1. **Devolución al stock normal:** implementado así. Una política distinta
   (p. ej. stock "usado") sería otro tipo de movimiento.
2. **Más de una orden abierta por auto:** permitido. No hay restricción por
   vehículo.
3. **Escalabilidad:** explicada en §3.8.
4. **Estructura del repo:** el monolito del TP3 ya está aparte (`monolito/`), y
   el README principal tiene la arquitectura y la guía de prueba.

## 5. Compatibilidad con las pruebas anteriores

- `scripts/pruebas-tp7.sh`: los escenarios **A y B** usan el token del
  administrador (alta administrada), y E muestra que el catálogo ya no es
  público. I crea el vehículo con dueño, y la baja ahora es lógica.
- `scripts/pruebas-tp6.sh`: vehículos con dueño, descuentos con `ordenId` y
  estados nuevos.
- Los dos scripts y `pruebas-correcciones.sh` fuerzan `LAB_ENDPOINTS=true`.
  `reset-datos.sh` (sin `--todo`) lo necesita.
- Las evidencias de `docs/tp6/` y `docs/tp7/` **no se regeneraron**, porque
  corresponden a las entregas (tags `tp6-entrega` y `tp7-entrega`).

## 6. Reparto y orden de merge

| Integrante | Rama | Qué entrega |
|---|---|---|
| Gregorio Luján | `docs/correcciones-plan` | este documento (requisitos, decisiones, matriz de acceso) |
| Jan Lahorca | `feature/inventario-movimientos` | inventory-service: libro de movimientos, alta, ingreso, ajuste, descuento ligado a la orden, reposición, laboratorio por variable (req. 5, 6, 7, 9, 10, 16) |
| Manuel Moya | `feature/vehiculos-duenio-baja` | vehicles-service: dueño obligatorio, duplicado detectado, baja lógica y reactivación (req. 4) |
| Agustín Martínez | `feature/ordenes-ciclo-de-vida` | workorders-service: estados, cancelación, finalizar, reposición automática, historial del vehículo (req. 4, 10, 13, 14) |
| Gregorio Luján | `feature/auth-sesion-renovable` | auth-service: alta administrada y sesión renovable (req. 1 y 3) |
| Gregorio Luján | `feature/correcciones-integracion` | métricas en los 6 servicios y el gateway, Compose, `.env.example`, scripts de prueba, README y evidencias |

Orden de merge: plan → inventory (Jan) → vehicles (Manu) → workorders (Agus) →
auth → integración. workorders usa el contrato nuevo de inventory
(`ordenId` y `/reposiciones`), por eso va después de Jan. La integración se
mergea al final y ahí se corren las pruebas sobre `main`.
