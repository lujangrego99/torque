# TP6 · Análisis de fallo parcial — Crear orden de trabajo

Caso elegido: **CU5 · `POST /api/ordenes`**. Es la única operación que cambia
estado en más de un servicio. TP6 §15.3.

## 1. Servicios que participan y orden

| # | Servicio | Operación | ¿Cambia estado? |
|---|---|---|---|
| 1 | `vehicles-service` | `GET /api/vehiculos/:id` (el vehículo existe) | no |
| 2 | `inventory-service` | `GET /api/repuestos/:id` por cada ítem (existe) | no |
| 3 | `workorders-service` | insert orden `PENDIENTE` con ítems `PENDIENTE` | **sí** — local |
| 4 | `inventory-service` | `POST /api/repuestos/:id/descontar` por cada ítem, en orden | **sí** — remoto, uno por ítem |
| 4′ | `workorders-service` | después de cada descuento: guarda el estado del ítem | sí — local |
| 5 | `workorders-service` | orden `CONFIRMADA` o `FALLIDA` | sí — local |

Los pasos 1 y 2 solo validan: si fallan, **no queda nada escrito** en ningún
servicio. La orden se registra (paso 3) **antes** de tocar stock ajeno, para que
siempre quede rastro de una operación que empezó a modificar otro servicio.

## 2. Cambios de estado por etapa

| Etapa | `inventory-db` | `workorders-db` |
|---|---|---|
| 3 | — | orden `PENDIENTE`, ítems `PENDIENTE` |
| 4 (ítem k OK) | `stock_k -= cantidad_k` | ítem k `DESCONTADO` ("stock restante N") |
| 4 (ítem k rechazado) | sin cambio para k | ítem k `RECHAZADO` + motivo, ítems siguientes `NO_INTENTADO` |
| 4 (ítem k timeout) | **desconocido** (pudo aplicarse) | ítem k `INCIERTO` |
| 5 OK | — | orden `CONFIRMADA` |
| 5 con falla | — | orden `FALLIDA`, `falla {etapa, servicio, causa, detalle}`, `requiereCompensacion` |

## 3. Qué pasa si falla cada etapa posterior a una ya confirmada

| Falla en… | Ya confirmado antes | Resultado | ¿Inconsistente? |
|---|---|---|---|
| 1 o 2 (vehicles/inventory caído o 404) | nada | `503` / `404`, **no** se crea orden | no |
| 3 (`workorders-db` caída) | nada | `503`, no se crea orden | no |
| 4, primer ítem, `409` o `503`/DNS | orden `PENDIENTE` | orden `FALLIDA`, `requiereCompensacion=false` | no: no se descontó nada |
| **4, ítem k > 1, `409` sin stock** | orden + descuentos 1..k-1 | orden `FALLIDA`, ítems 1..k-1 `DESCONTADO`, `requiereCompensacion=true` | **sí**: hay stock descontado para una orden que no se va a hacer |
| **4, ítem k, timeout** | orden + descuentos 1..k-1 | ítem k `INCIERTO`; `inventory` puede haberlo descontado igual | **sí, y ambiguo**: no se sabe si k se aplicó |
| **4′ / 5 (`workorders-db` cae después de un descuento)** | descuentos ya aplicados en `inventory` | la orden queda `PENDIENTE` o con ítems desactualizados; responde `503` | **sí**: el stock remoto cambió y la orden no lo refleja |
| `workorders-service` se cae (proceso) en medio del paso 4 | orden + algunos descuentos | la orden queda `PENDIENTE` para siempre | **sí** |

**Conclusión:** el sistema **sí puede quedar parcialmente actualizado**. No hay
transacción distribuida entre `workorders-db` e `inventory-db`. Cada descuento
de stock se confirma en `inventory-service` en el momento y no hay rollback
automático.

## 4. Reproducción (evidencia real)

`docs/tp6/evidencias/09-fallo-parcial.txt`:

1. Stock semilla: filtro 1, pastillas 4, bujías 8. Una orden previa agota el filtro.
2. Orden "Service completo": bujías ×4 → filtro ×1 → pastillas ×1.
3. Resultado: `409`, orden `FALLIDA`:
   - bujías `DESCONTADO` ("stock restante 4"),
   - filtro `RECHAZADO` ("Stock insuficiente…"),
   - pastillas `NO_INTENTADO`,
   - `requiereCompensacion: true`.
4. `GET /api/repuestos` → bujías quedó en **4**: el descuento se aplicó aunque la
   orden falló.
5. Log: `[ERROR] [workorders-service] Orden … FALLIDA … FALLO PARCIAL: stock ya descontado/incierto para BUJ-NGK-001x4[DESCONTADO] — requiere compensación.`

Variante timeout: con `INVENTORY_TIMEOUT_MS=500` y `DEMO_DELAY_MS=1000`, la orden
responde `503` con el ítem `INCIERTO`, pero `inventory` sí descontó (bujías
8 → 7). Esto muestra que **un timeout no significa que la operación no ocurrió**.

## 5. Información para detectar, recuperar o compensar (evolución futura)

Lo que **ya** se guarda y permite detectar el problema:

- `ordenes.estado` (`PENDIENTE` / `FALLIDA`) y `requiereCompensacion`.
- Por ítem: `repuestoId`, `cantidad`, `estado` (`DESCONTADO` / `INCIERTO` / …) y `detalle`.
- `falla.{etapa, servicio, causa, detalle}`.
- `createdAt` / `updatedAt` (una orden `PENDIENTE` vieja = proceso interrumpido).
- El `x-request-id` en los logs de todos los servicios para reconstruir la secuencia.
- Si la base de órdenes no está disponible al guardar, se loguea
  `INCONSISTENCIA: … Descuentos ya aplicados en inventory-service: <id>x<cant>, …`.

Lo que **faltaría** para recuperar o compensar automáticamente:

1. **Operación de compensación en inventory**: `POST /api/repuestos/:id/reponer`
   (o "devolver"), para revertir los ítems `DESCONTADO` de una orden `FALLIDA`.
2. **Idempotencia del descuento**: mandar un id de operación
   (`ordenId:repuestoId`) y que `inventory` guarde los ya aplicados. Así un
   reintento después de un timeout no descuenta dos veces, y un ítem `INCIERTO`
   se puede resolver preguntando "¿aplicaste `ordenId:repuestoId`?".
3. **Reconciliador**: un proceso periódico que busque órdenes `PENDIENTE` viejas
   o `FALLIDA` con `requiereCompensacion=true`, consulte o compense en `inventory`
   y marque la orden como `COMPENSADA`.
4. **Patrón Saga / outbox**: registrar cada paso como evento (outbox en
   `workorders-db`) y procesarlo de forma asíncrona, con compensaciones
   explícitas por paso.
5. Alternativa de diseño: **reservar** stock (estado reservado con vencimiento)
   y confirmarlo recién cuando la orden se confirma (dos fases a nivel negocio).

Nada de esto se implementa en el TP6 (no es obligatorio). El objetivo de esta
entrega es que el fallo parcial sea **detectable y observable**, no silencioso.
