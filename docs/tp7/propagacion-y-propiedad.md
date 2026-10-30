# TP7 · Propagación de identidad y propiedad del recurso

**Autor:** Agustín Martínez (`workorders-service`)

## Caso de uso que atraviesa servicios: crear una orden

```
Cliente
   | POST /api/ordenes            Authorization: Bearer <JWT de mecanico1>
   v
api-gateway            reenvía Authorization sin tocarlo (no valida)
   v
workorders-service     valida el JWT → req.usuario = { id: sub, rol }
   | GET  /api/vehiculos/:id               Authorization: Bearer <MISMO JWT>
   +--> vehicles-service                   valida el JWT (MECANICO, ADMIN)
   | GET  /api/repuestos/:id               (público, igual lleva el token)
   | POST /api/repuestos/:id/descontar     Authorization: Bearer <MISMO JWT>
   +--> inventory-service                  valida el JWT (MECANICO, ADMIN)
   v
workorders-db          orden { …, creadaPor: sub }
```

**Estrategia elegida: propagar el access token del cliente** (admitida por el
TP, §13). El cliente HTTP de workorders (`src/clients/http.js`) agrega
`Authorization: Bearer <token>` a cada llamada. Así:

- vehicles e inventory **validan por su cuenta** la misma identidad. No confían en que workorders ya la revisó: dentro de la red `backend`, un `POST …/descontar` sin token también da 401 (evidencia `J-propagacion.txt`).
- Si el usuario no tiene permiso para consumir stock, inventory responde 403 y la orden no avanza, igual que si lo pidiera directo.
- El token nunca se loguea. Solo se registra `sub=<id>` en la línea de la orden.

**Alternativa descartada:** un token de servicio propio de workorders (client
credentials). Haría falta otro mecanismo de emisión y se perdería **quién**
consumió el stock. Para este alcance, propagar el token del usuario es más
simple y conserva la trazabilidad.

**Costo de la decisión:** si el token vence a mitad de la operación, el
servicio de abajo responde 401:

- en la validación del vehículo → la orden no se crea (401);
- en un descuento → el ítem queda `RECHAZADO` y la orden `FALLIDA`, igual que el fallo parcial del TP6 (`docs/tp6/fallo-parcial.md`).

Con una vigencia de 15 minutos y una operación de 1–2 segundos es un caso de
borde, pero está cubierto.

## Propiedad del recurso (§11.2)

El rol no alcanza: dos MECANICO tienen el mismo rol, pero cada uno solo debe
ver sus órdenes.

| Operación | MECANICO | ADMIN |
|---|---|---|
| `POST /api/ordenes` | crea con `creadaPor = sub` | ídem |
| `GET /api/ordenes` | solo las suyas (`{ creadaPor: sub }`) | todas |
| `GET /api/ordenes/:id` | si `creadaPor ≠ sub` → **403** `La orden pertenece a otro usuario.` | todas |

- Se responde **403 y no 404**: la identidad es válida pero no está autorizada sobre ese recurso. Es la semántica que pide el TP (§11.1).
- `creadaPor` es una **referencia lógica** al `sub` del token, igual que `vehiculoId` y `repuestoId`. workorders no conoce la base de usuarios ni le pregunta nada a auth-service.
- Las órdenes creadas antes del TP7 no tienen `creadaPor`: solo las ve ADMIN.

## ¿Qué pasa si auth-service se cae después de emitir el token?

| Operación | Resultado |
|---|---|
| Requests con un token ya emitido (vehículos, órdenes, stock) | **siguen funcionando** hasta el `exp`. La verificación es local (firma HS256 + `exp`), sin consultar a auth-service |
| `POST /api/auth/login` · `register` | **503** controlado del gateway (`Servicio no disponible.`) |
| Al volver auth-service | login normal; los usuarios siguen en `auth-data` |

Evidencia: `docs/tp7/evidencias/M-auth-no-disponible.txt`.

**Consecuencia asumida:** deshabilitar un usuario o cambiarle el rol no
invalida los tokens que ya tiene. El cambio se aplica en su próximo login, a
más tardar en `JWT_EXPIRES_IN` (15 min). Para revocación inmediata haría falta
una lista de revocación consultada en cada request, que es justo lo que el
diseño evita (§12 del enunciado).
