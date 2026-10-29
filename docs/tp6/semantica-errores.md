# TP6 · Semántica de errores entre servicios

Cómo distingue cada servicio un **error funcional** (el remoto respondió y dijo
"no") de un **error de infraestructura** (no hubo respuesta válida). TP6 §15 y
§15.2.

## 1. Lo que responde cada servicio dueño

| Servicio | Situación | Status | Tipo |
|---|---|---|---|
| todos | body JSON malformado / campos inválidos / id no hexadecimal | `400` | funcional |
| `vehicles-service` | vehículo inexistente | `404` | funcional |
| `vehicles-service` | patente duplicada | `409` | funcional |
| `inventory-service` | repuesto inexistente | `404` | funcional |
| `inventory-service` | stock insuficiente | `409` (con `item` y stock actual) | funcional |
| `inventory-service` | lock tomado por otra operación ("Recurso ocupado") | `409` | funcional (reintentable) |
| `inventory-service` | Redis/Memurai caído (descuento seguro o diagnóstico de lock) | `503` | infraestructura propia |
| todos los que tienen base | su MongoDB caída | `503` (`"La base de datos de <servicio> no está disponible."`) | infraestructura propia |
| todos | error inesperado del propio código | `500` | fallo propio |

`503` significa "estoy vivo pero una dependencia mía no está". `500` queda
reservado para errores del propio servicio.

## 2. Cómo lo trata el consumidor (`workorders-service`)

El cliente HTTP (`services/workorders-service/src/clients/http.js`) usa `fetch`
nativo con `AbortSignal.timeout(...)` y separa los casos así:

| Situación remota | Ejemplo | Qué devuelve el cliente | Qué responde `workorders-service` |
|---|---|---|---|
| Recurso inexistente | `404` de vehicles / inventory | `{ status: 404, body }` | `404` "Vehículo/Repuesto no encontrado" — **no** se convierte en 503 |
| Conflicto de negocio | `409` stock insuficiente / ocupado | `{ status: 409, body }` | `409` y la orden queda `FALLIDA` con el detalle del remoto |
| Datos inválidos | `400` del remoto | `{ status: 400, body }` | se propaga como error funcional |
| Timeout | sin respuesta en `INVENTORY_TIMEOUT_MS` | `ErrorDependencia(causa: "timeout")` | `503` · si fue en un descuento, el ítem queda `INCIERTO` |
| DNS | `ENOTFOUND` (contenedor detenido) | `ErrorDependencia(causa: "dns")` | `503` |
| Conexión rechazada | `ECONNREFUSED` (proceso caído, local) | `ErrorDependencia(causa: "conexion_rechazada")` | `503` |
| El remoto avisa indisponibilidad | `503` del remoto (su base o Redis caídos) | `ErrorDependencia(causa: "no_disponible")` | `503` |
| Fallo remoto inesperado | otro `5xx` | `ErrorDependencia(causa: "error_remoto", statusRemoto)` | `502` + log con servicio, ruta y status |

Cada fallo queda en el log con **servicio origen, dependencia, ruta, causa y
request id**, por ejemplo:

```
[ERROR] [workorders-service] → inventory-service GET /api/repuestos/68c0…13 falló: dns (ENOTFOUND) rid=…
[ERROR] [workorders-service] POST /api/ordenes 503 12ms rid=…
```

## 3. Cómo lo trata el borde (`api-gateway`)

- Cualquier respuesta del servicio dueño (2xx, 4xx o 5xx) se devuelve **sin
  modificar**: el gateway no reinterpreta reglas de negocio.
- Si el servicio dueño no responde (timeout, DNS, conexión rechazada), el
  gateway responde `503` propio con `servicio` y `causa`:

```json
{
  "error": "Servicio no disponible.",
  "servicio": "inventory-service",
  "causa": "dns",
  "detalles": ["inventory-service no respondió (dns: ENOTFOUND). Reintentar más tarde."]
}
```

## 4. Timeouts configurados

| Llamada | Variable | Valor por defecto | Por qué |
|---|---|---|---|
| workorders → vehicles | `VEHICLES_TIMEOUT_MS` | 2000 ms | consulta simple |
| workorders → inventory | `INVENTORY_TIMEOUT_MS` | 5000 ms | el descuento con lock incluye `DEMO_DELAY_MS` (1000 ms en Compose) |
| gateway → servicio | `PROXY_TIMEOUT_MS` | 15000 ms | una orden hace varias llamadas internas en serie |
| gateway → `/health` de cada servicio | `HEALTH_TIMEOUT_MS` | 2000 ms | vista agregada `/health/servicios` |

## 5. Observación: DNS en redes `internal`

En la primera versión del Compose la red `backend` estaba marcada
`internal: true`. Al detener `inventory-service`, el gateway (que además está en
`edge`) recibía `ENOTFOUND` al instante, pero `workorders-service` (solo en
`backend`) se quedaba esperando hasta su timeout de 5 s. En una red interna,
el DNS embebido de Docker no puede reenviar a un DNS externo un nombre que no
conoce, y la consulta queda colgada. Se quitó `internal`. Igualmente, el caso de
timeout ya respondía un `503` controlado gracias al timeout explícito del cliente.

Evidencia: `docs/tp6/evidencias/08-fallo-dependencia.txt`.
