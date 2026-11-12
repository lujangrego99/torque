# Torque — pruebas para la defensa (12/11/2026)

Complemento **medido** de la auditoría del 12/11 (que no ejecutó Docker ni carga).
Todo lo de este documento se corrió contra el stack completo en Docker (10 contenedores), commit `625d721` (tag `correcciones-rev1`), sin tocar código de producto.

- Máquina: 12 hilos, 31 GB RAM. **El generador de carga corre en la misma PC**: compite por CPU, así que los números son un piso conservador, no un máximo.
- Stack aislado: `docker compose -p torque-defensa` en el puerto 3100 (no toca los volúmenes de la demo).
- Salida cruda de cada prueba: [`resultados/`](resultados/) (`.txt` legible + `.json`).
- `DEMO_DELAY_MS`: Compose lo deja en **1000 ms** por defecto (retardo artificial del TP2 dentro de la sección crítica). Por eso se midió con 1000 (como está la demo) y con 0 (comportamiento real del código).

## Resumen en 30 segundos

| Pregunta | Respuesta medida |
|---|---|
| ¿Cuántas lecturas aguanta? | **~600–800 req/s**. Con 1000 usuarios simultáneos: **0 errores**, pero la mediana sube a ~1,2 s (cola). El cuello es el **gateway** (un proceso Node, 93 % de un núcleo). |
| ¿Y si entran 100 personas a la vez? | El login es el cuello: **~1,8 logins/s** (bcrypt costo 12 en JS puro ≈ 0,6 s de CPU cada uno). 50 logins juntos → 15 dan **503** por el timeout del gateway (15 s). |
| ¿Cuántas órdenes por segundo? | Sin competir por repuesto: **~130 órdenes/s** (delay 0) / ~60/s (delay 1 s de la demo). 0 errores, invariantes OK. |
| ¿Y si todos piden el mismo repuesto? | El stock **nunca** queda negativo ni descuadrado. Pero el lock no hace cola: con delay 1 s, de 100 pedidos simultáneos **1 entra y 99 reciben 409 «Recurso ocupado»** (orden FALLIDA). |
| ¿Se cae X? | Cada caída afecta solo a su dominio. Detalle en la [tabla de caídas](#qué-pasa-si-se-cae-x). |
| ¿Los hallazgos de la auditoría son reales? | Sí: **H02, H03, H04, H05, H07 y H15 se reprodujeron en vivo** en Docker. |

---

## ¿Qué pasa si hay N usuarios? (lectura)

`carga.mjs lectura`: N usuarios en bucle cerrado (piden, esperan la respuesta, vuelven a pedir), 10 s por nivel; mitad `GET /api/repuestos`, mitad `GET /api/vehiculos/:id`, todos con JWT.

| Usuarios | req/s | p50 | p95 | p99 | Errores |
|---:|---:|---:|---:|---:|---:|
| 1 | 117 | 7 ms | 18 ms | 34 ms | 0 |
| 10 | 490 | 17 ms | 44 ms | 58 ms | 0 |
| 50 | 774 | 52 ms | 126 ms | 184 ms | 0 |
| 100 | 573 | 150 ms | 344 ms | 720 ms | 0 |
| 250 | 589 | 379 ms | 787 ms | 1,4 s | 0 |
| 500 | 606 | 712 ms | 1,1 s | 5,4 s | 0 |
| 1000 | 630 | 1,2 s | 4,8 s | 9,3 s | 0 |

**Cómo explicarlo:**
- A partir de ~50 usuarios el throughput **se aplana** (~600 req/s): el sistema está saturado. Más usuarios no dan más respuestas por segundo, solo **más espera** (cola). Ley de Little: 1000 usuarios / 630 req/s ≈ 1,6 s de espera promedio, que es lo que se ve.
- **No se cae**: 0 errores con 1000 usuarios. Se degrada en latencia, no en disponibilidad, porque ningún timeout llega a cortar (el gateway espera hasta 15 s).
- **Cuello de botella:** `docker stats` en la corrida de 1000 usuarios marca el **api-gateway al 93 %** (Node usa un solo hilo para JS, así que ~100 % es el techo de un proceso). Los servicios están al ~60 % y las bases al ~10 %.
- **Cómo se escala:** como los servicios son *stateless* (el JWT viaja en cada pedido; no hay sesión en memoria), se pueden correr **varias réplicas** detrás de un balanceador. Primero el gateway (es el cuello), después los servicios. Las bases y Redis no se escalan igual: eso requiere replica set / sharding (no implementado). **No lo medimos con réplicas**: es la mejora, no un resultado.

## ¿Y si entran todos a la vez? (login)

`carga.mjs login`: N logins exactamente simultáneos. Mientras tanto, otro cliente consulta `/api/auth/me`, que no usa bcrypt.

| Logins simultáneos | Tiempo total | Logins/s | p50 | Resultado | `/me` durante la ráfaga (máx.) |
|---:|---:|---:|---:|---|---:|
| 1 | 0,6 s | 1,7 | 589 ms | 1 OK | 263 ms |
| 10 | 5,7 s | 1,8 | 5,1 s | 10 OK | 1,6 s |
| 25 | 13,4 s | 1,9 | 9,4 s | 25 OK | 12,6 s |
| 50 | 15,1 s | — | 11,2 s | **35 OK, 15 × 503** | 15 s |
| 100 | 15,1 s | — | 15,1 s | **25 OK, 75 × 503** | 11,4 s |

**Por qué:** `bcryptjs` es bcrypt en **JavaScript puro**, con costo 12 (2¹² iteraciones ≈ 0,6 s de CPU por login). Corre en el único hilo de auth-service, así que los logins se atienden **de a uno** y además **traban todo el servicio** (`/me` llega a esperar 15 s).
Después de 15 s el gateway corta con 503, pero **auth sigue calculando esos hashes**: el siguiente login, lanzado apenas terminó la ráfaga, también dio 503 por timeout. Un timeout del cliente no cancela el trabajo del servidor.

**Respuesta para la defensa:** «El costo de bcrypt es deliberado: hace caro el ataque por fuerza bruta. El precio es que el login es la operación más cara del sistema. Lo medimos: ~2 logins/s por réplica. No es un problema en un taller (los mecánicos se loguean una vez por turno y la renovación con refresh token usa SHA-256, no bcrypt), pero sí un vector de **DoS**: 20 intentos fallidos por segundo saturan auth.»

**Mejoras:**
1. `bcrypt` nativo o `argon2`, que corren en el threadpool y no bloquean el event loop.
2. Rate limit por IP y por cuenta en `/login`.
3. Réplicas de auth.
4. Ajustar el costo (10 ≈ 4 veces más rápido).

## Órdenes de trabajo bajo carga

### Cada usuario con su propio repuesto (sin competencia por el lock) — `carga.mjs ordenes`

| Usuarios | Órdenes/s (delay 1 s, como la demo) | p50 | Órdenes/s (delay 0, real) | p50 | Errores | Invariantes |
|---:|---:|---:|---:|---:|---:|---|
| 1 | 1,0 | 1,0 s | 23 | 39 ms | 0 | OK |
| 10 | 9,2 | 1,1 s | 59 | 159 ms | 0 | OK |
| 50 | 39 | 1,1 s | 93 | 519 ms | 0 | OK |
| 100 | 63 | 1,5 s | **134** | 663 ms | 0 | OK |

Crear una orden son ~6 llamadas internas: validar el vehículo y el repuesto, insertar la orden, descontar (con lock en Redis y 2 escrituras en Mongo), guardar el avance y pasar a EN_PROCESO. Con 100 usuarios, **workorders-service queda al 100 %** de un núcleo: es el cuello en escritura.

### Todos piden el MISMO repuesto (repuesto «caliente») — `carga.mjs hot`

| Pedidos simultáneos | delay 1 s: OK / 409 ocupado | delay 0: OK / 409 ocupado | Stock final | Invariantes |
|---:|---|---|---|---|
| 2 | 1 / 1 | 1 / 1 | correcto | OK |
| 10 | 1 / 9 | 4 / 6 | correcto | OK |
| 50 | 1 / 49 | 31 / 19 | correcto | OK |
| 100 | **1 / 99** | 41 / 59 | correcto | OK |

- **Correctitud:** nunca hubo sobreventa ni descuadre (stock = suma del libro de movimientos).
- **Disponibilidad:** el descuento **no espera** el lock (`conLock` sin `esperaMs`): si está ocupado responde 409 al instante. Es una decisión de diseño heredada del TP2 (*fail fast*). El costo es que bajo contención **la mayoría de las órdenes fallan** y quedan registradas como FALLIDA.
- **Mejora:** esperar el lock con *backoff* (como ya hacen ingreso, ajuste y reposición), o, mejor, hacer el descuento atómico en Mongo (`updateOne({_id, stock: {$gte: n}}, {$inc: {stock: -n}})`). Eso elimina la necesidad del lock para el stock.

### Stock escaso: 5 unidades, 30 clientes que reintentan — `carga.mjs stock`

| delay | Órdenes OK | Rechazadas por stock | Stock final | Pedidos HTTP totales | Tiempo |
|---|---:|---:|---:|---:|---:|
| 1000 ms | **5** | **25** | **0** | 639 (reintentos por «ocupado») | 5,6 s |
| 0 ms | **5** | **25** | **0** | 58 | 0,7 s |

Exactamente lo esperado: **nunca negativo**, ni una unidad de más ni de menos. Esta es la prueba para mostrar si preguntan «¿cómo saben que el lock funciona?».

### Listado sin paginar — `carga.mjs listado`

`GET /api/ordenes` devuelve **todas** las órdenes: con 5.481 órdenes son **4,4 MB y ~0,9 s**. Con 10 usuarios listando a la vez: **1,1 req/s, p50 7 s**.
En cambio, `GET /api/repuestos/movimientos` tiene tope (`limite`, máx. 500) y tarda 55 ms.
**«¿Y con un millón de órdenes?»** → El listado no escala: falta **paginación** (`limit` + cursor por `_id`/`createdAt`). Los índices sí están (`estado`, `creadaPor`, `vehiculoId`, `patente`).

---

## ¿Qué pasa si se cae X?

`caos.mjs` detiene o mata cada pieza con `docker compose stop/kill` y mide qué sigue andando.

| Cae… | Qué deja de andar | Qué sigue andando | Medido |
|---|---|---|---|
| **auth-service** | Login nuevo (503 en 5 s) | **Todo lo demás con tokens ya emitidos** (vehículos, repuestos, órdenes: 200/201) | K1 |
| **inventory-service** | Repuestos (503); órdenes **con** repuestos → 503 **sin dejar orden registrada** | Vehículos; órdenes **sin** repuestos (201) | K2 |
| **redis** | Toda escritura de stock: orden con repuesto → 503 (FALLIDA, nada descontado); ingreso → 503 | Lecturas de stock (van a Mongo). Invariantes OK | K3 |
| **vehicles-service** | Crear órdenes (503, no queda orden) | Historial de órdenes, repuestos | K4 |
| **workorders-db** | Órdenes (503) | Vehículos, repuestos, login | K5 |
| **workorders muere a mitad de una orden** | ⚠️ **Orden huérfana PENDIENTE** con stock ya descontado (H05). Cancelarla **no devuelve** el stock (2 unidades perdidas) | — | K6 |
| **inventory muere a mitad de una orden** | Orden FALLIDA, reposición PENDIENTE | Al volver: `POST /api/ordenes/:id/reponer` → **COMPLETA**, invariantes OK | K7 |
| **timeout** de workorders → inventory | Ítem **INCIERTO** (pudo o no haberse aplicado) | La reposición consulta el libro: devolvió las 3 unidades. Stock correcto | K8 |
| **reinicio completo** | ~8 s hasta healthy | Datos intactos (volúmenes); **los tokens viejos siguen sirviendo** (JWT sin estado) | K9 |

Frases para defender:
- «**Sin Redis preferimos rechazar a escribir sin exclusión mutua**: elegimos consistencia sobre disponibilidad (CAP) para el stock».
- «Una base por servicio: la caída de una base solo afecta su dominio» (K5).
- «Validamos todo lo remoto **antes** de registrar la orden: si falta una dependencia, no queda basura» (K2, K4).
- «Un timeout no prueba que la escritura no ocurrió; por eso existe el estado INCIERTO y la reposición consulta el libro» (K8).

Detalle honesto de K8: la orden quedó con `reposicion: PENDIENTE` aunque el libro ya tenía la REPOSICION (inventory terminó después del timeout). El stock es correcto y un reintento la marca COMPLETA, pero **el estado de la orden queda desactualizado** hasta que alguien reintenta.

Detalle de K2/K5: cuando un contenedor está detenido, el 503 tarda **~5 s** (resolución DNS del nombre en la red de Docker), no es instantáneo.

---

## Hallazgos de la auditoría reproducidos EN VIVO

La auditoría los había demostrado con dobles; acá se ejecutaron contra Docker (`carreras.mjs`, `caos.mjs`).

| Hallazgo | Qué se hizo | Resultado |
|---|---|---|
| **H02** Cancelar durante el descuento | Crear orden (3 unidades) y cancelar a los 400 ms | Orden **CANCELADA**, reposición NO_REQUERIDA, libro `[DESCUENTO -3]`, **stock 10 → 7**. El reintento de reposición responde 409: **no hay camino por la API para recuperarlo** (solo un ajuste del ADMIN). |
| **H03** Rutas directas de inventario | MECANICO llama `POST /api/repuestos/:id/descontar` con un `ordenId` inventado | **200, stock 10 → 6**. Y `POST /api/repuestos/reposiciones` de una orden **FINALIZADA** → 200, devuelve al stock repuestos que ya se usaron. |
| **H04** El lock vence (TTL) | `LOCK_TTL_MS=300` y delay de 1 s; segunda orden a los 500 ms | **Las dos 201, stock 1 → −1** (sobreventa). Control con TTL 8 s: la segunda da 409 y el stock queda en 0. |
| **H05** Recuperación incompleta | SIGKILL a workorders durante un descuento | Orden **PENDIENTE para siempre**, libro `[DESCUENTO -2]`. Cancelarla no repone (los ítems están PENDIENTE, no DESCONTADO). |
| **H07** Logout | Logout y después usar el access viejo | Access → **200** (sigue vigente hasta que vence); refresh → 401. |
| **H15** Doble POST | El mismo cuerpo dos veces | **Dos órdenes 201**, stock 10 → 8. Si son simultáneos: 201 + 409 (queda una FALLIDA de más). |

Lo que **sí** está bien resuelto (para contrastar):
- El descuento es **idempotente por `ordenId`**: si workorders reintenta el mismo descuento, no se descuenta dos veces.
- Una REPOSICION bloquea descuentos tardíos de esa orden **si el ítem estaba INCIERTO**. H02 pasa justo porque el ítem estaba PENDIENTE y no se incluye.
- La cancelación y la finalización son transiciones **atómicas** (`findOneAndUpdate` condicionado al estado).

---

## Preguntas «¿y si…?» con respuesta corta

**¿Y si hay 10.000 usuarios?** No lo soporta una sola réplica: medimos ~600 lecturas/s y ~130 órdenes/s en una PC, con latencias que crecen linealmente después de la saturación. 10.000 usuarios *registrados* no es lo mismo que 10.000 pidiendo a la vez: un taller real tiene decenas. Para escalar: réplicas del gateway y los servicios (son stateless), un balanceador, Mongo con replica set y paginación. No está medido.

**¿Cuál es el cuello de botella?** Depende de la operación (medido): lecturas → gateway; login → bcrypt en auth; órdenes → workorders; mismo repuesto → el lock (serializa por diseño).

**¿Por qué Node no usa los 12 núcleos?** El event loop corre JS en un solo hilo por proceso. Se aprovechan más núcleos con más procesos (réplicas o `cluster`), no con hilos.

**¿Qué pasa si se cae el gateway?** Es un **punto único de falla** de entrada (los servicios siguen vivos, pero nadie llega). Mejora: 2+ réplicas detrás de un balanceador.

**¿Y Redis?** También punto único para escribir stock (K3: rechaza, no corrompe). Redlock o Redis Sentinel lo mitigan, pero el lock por TTL sigue sin fencing (H04). La solución de fondo es la **condición atómica en Mongo**.

**¿Por qué no una transacción distribuida (2PC)?** Bloquea recursos entre servicios y acopla la disponibilidad de todos. Usamos el patrón **saga con compensación** (DESCUENTO → REPOSICION), que ya existe en el libro. Su límite es que la compensación es *best effort*: falta un worker durable que reintente (H05).

**¿Por qué Mongo no es atómico en H01?** Lo es por documento. Stock (repuestos) y movimiento (movimientos) son dos documentos en dos colecciones. Con Mongo **standalone** no hay transacciones multi-documento: hace falta un **replica set** (aunque sea de 1 nodo) para usar `session.withTransaction()`.

**¿Aumentar el TTL arregla H04?** Reduce la probabilidad, pero no elimina pausas arbitrarias (GC, CPU saturada: medimos workorders al 100 %). Lo arregla una guardia en la escritura (`stock >= n` en el `updateOne`) o un *fencing token*.

**¿Qué consistencia tiene el sistema?** Fuerte dentro de cada servicio sobre un documento; **eventual** entre servicios (la orden y el libro se reconcilian por la compensación). Para el stock elegimos CP: sin Redis, se rechaza.

**¿Por qué el gateway no valida el JWT?** Defensa en profundidad: cada servicio valida firma, emisor, audiencia y vencimiento por su cuenta y no confía en que «alguien antes lo revisó». El gateway solo enruta.

**¿Qué pasa si roban el `JWT_SECRET`?** Con HS256, el mismo secreto firma y verifica, y está en 5 servicios: si se filtra uno, se pueden fabricar tokens de ADMIN. Mejora: **RS256**, donde solo auth tiene la clave privada y los demás, la pública.

**¿Logout invalida el acceso?** No del todo (H07, medido): el access sigue vigente hasta que vence. **En este `.env` vence a los 15 min, no a los 5 min del default**: revisar en la máquina de la exposición. Para revocar al instante haría falta una lista de revocación o tokens más cortos.

**¿Hay protección contra fuerza bruta?** bcrypt la encarece (~0,6 s por intento), pero **no hay rate limit** ni bloqueo de cuenta. Además, el mismo costo de bcrypt permite saturar el login (medido).

**¿Y si el usuario hace doble clic?** Se crean dos órdenes (H15, medido). Mejora: header `Idempotency-Key` en el alta. El descuento ya es idempotente por `ordenId`; el alta no.

**¿Qué pasa si Docker se reinicia?** Medido: ~8 s hasta healthy y los datos intactos. Pero un volumen **no es un backup**: `docker compose down -v` lo borra todo. No hay backup/restore probado (H13).

**¿Por qué 409 «Recurso ocupado» en vez de esperar?** Es el comportamiento del TP2, conservado a propósito (*fail fast*). Bajo contención fuerte, el 99 % falla (medido). Ingreso, ajuste y reposición sí esperan el lock.

**¿Cómo saben que el stock no queda inconsistente?** Script de invariantes: para cada repuesto, el stock debe ser igual a la suma del libro y no ser negativo; para cada orden, el libro neto debe coincidir con su estado. Dio OK en todas las cargas y lo detectó en H02/H05.

---

## Mejoras priorizadas (si preguntan «¿qué harían ahora?»)

1. **Descuento atómico en Mongo** (`$gte` en el `updateOne`): cierra H04 y permite que el descuento no dependa del TTL. *Chico.*
2. **Replica set de 1 nodo + transacción** para stock + movimiento: cierra H01. *Chico/medio.*
3. **Cancelación que incluya ítems PENDIENTE** en la reposición (con REPOSICION de 0 que bloquee el descuento tardío): cierra H02. *Chico.*
4. **Worker de reconciliación** (órdenes PENDIENTE viejas ↔ libro): cierra H05. *Medio.*
5. **Autorizar las rutas directas de inventario** según el estado de la orden (o hacerlas internas, con token de servicio): cierra H03. *Medio.*
6. **Paginación** en `/api/ordenes`. *Chico.*
7. **Rate limit y bcrypt nativo/argon2** en el login. *Chico.*
8. **Idempotency-Key** en el alta de órdenes: cierra H15. *Chico.*
9. **Réplicas + balanceador** del gateway y los servicios. *Medio.*

---

## Cómo reproducir

```bash
# Stack aislado (no toca la demo): puerto 3100
GATEWAY_HTTP_PORT=3100 GATEWAY_HTTPS_PORT=3543 docker compose -p torque-defensa up --build -d --wait

node scripts/defensa/carga.mjs     [lectura|login|ordenes|hot|stock|listado|todo]
node scripts/defensa/carreras.mjs  [h02|h03|h04|h07|h15|todo]
node scripts/defensa/caos.mjs      [auth|inventory|redis|vehicles|wodb|killwo|killinv|timeout|reinicio|todo]

# Ensayo de la demo del repaso, en la MÁQUINA DE LA EXPOSICIÓN (stack real, puerto 3000).
# Crea el usuario carga1@torque.local y 2 órdenes de prueba.
GW=http://localhost:3000 PROYECTO=torque node scripts/defensa/ensayo-demo.mjs

# Apagar y borrar el stack de pruebas
docker compose -p torque-defensa down -v
```

Los scripts leen la contraseña del admin de `.env` y nunca la imprimen. `carga.mjs`, `carreras.mjs` y `caos.mjs` reconfiguran o matan contenedores: **no correrlos contra el stack de la demo**.

## Advertencias para la demo (salieron de estas pruebas)

- El repuesto semilla **FIL-ACE-001 arranca con stock 1** (es el de la demo de carrera). Para el recorrido usar **BUJ-NGK-001 (stock 8)** o PAS-FRE-001 (4). `ensayo-demo.mjs` elige solo el que tiene más stock.
- Con `DEMO_DELAY_MS=1000`, **cada orden con repuestos tarda ~1 s**. Es normal: es el retardo del laboratorio.
- **No hacer doble clic** en Execute de Swagger: crea dos órdenes (H15).
- Si se hace una ráfaga de logins, auth queda ocupado un buen rato (sigue procesando la cola).
