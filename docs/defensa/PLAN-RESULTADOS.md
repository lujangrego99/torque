# Torque — Resultados del «Plan completo de pruebas» (corrida del 12/11/2026)

Devolución de las secciones 7 y 8 del plan, una fila por ID: las 42 pruebas existentes (E01–E42) y las 35 adicionales (X01–X35).

| Campo | Valor |
|---|---|
| Fecha / responsable | 12/11/2026 · Goyo (lujangrego99), con asistencia de Claude |
| SHA del producto | `625d7213eefbdcf5d755f56a0ed92c7b6b527ea8`. La rama `defensa/pruebas-carga-2026-11-12` solo agrega scripts y documentos. |
| Entorno | Linux 7.3.3 · 12 hilos · 31 GB · Docker 29.9.3 · Compose 5.7.0 |
| Aislamiento | Proyecto Compose `torque-defensa`, gateway en 3100/3543 y volúmenes propios. Las suites corrieron desde un worktree aparte, así que **no se pisó ninguna evidencia histórica**. |
| Evidencia | Suites: [`evidencias-suites-2026-11-12/`](evidencias-suites-2026-11-12/), con tokens enmascarados. X y carga: [`resultados/`](resultados/). |

Estados: **PASS** · **FAIL** · **REPRO** (defecto conocido reproducido: es PASS de reproducción y FAIL del requisito, como pide el plan) · **BLOQUEADA** · **PARCIAL**.

## Resumen

| Grupo | PASS | REPRO / FAIL | BLOQUEADA / PARCIAL |
|---|---|---|---|
| E01–E42 (suites) | **42/42** sobre datos limpios | — | — |
| X01–X10 (P0, obligatorias para la demo) | **10/10** | — | — |
| X11–X27 (P1) | 8 | REPRO: X14, X15, X16, X18, X20, X21 · FAIL: X24 (vehículo), X26 | BLOQUEADA: X25 · PARCIAL: X17, X19 |
| X28–X35 (P2) | 6 | FAIL: X33 | PARCIAL: X35 |

**Veredicto, según la sección 8 del plan:** las P0 X01–X10 están completas y en PASS, el recorrido normal se repitió dos veces sin diferencias y stock y libro de la demo son coherentes. Eso habilita **la demo controlada**. Los defectos P1/P2 quedan visibles abajo, cada uno con su hallazgo asociado. Nada de esto certifica producción ni alta disponibilidad.

### Hallazgos nuevos de esta corrida (no estaban en la auditoría o no tenían evidencia integrada)

1. **El `.env` de la PC tiene `JWT_EXPIRES_IN=15m`**, mientras Swagger, `.env.example` y el default de Compose dicen 5m. Se generó con un `.env.example` anterior al commit `5fe4b9d`. **Corregir en la máquina de exposición: `JWT_EXPIRES_IN=5m`.** No es un bug de código.
2. **X26:** un ingreso con `cantidad: 9007199254740993` (2⁵³+1) **se acepta** y deja el stock en 9007199254741002, con pérdida de precisión (H19). Habría que limitar las cantidades a un máximo de negocio.
3. **X26:** un cuerpo de más de 100 KB (límite de `express.json`) o de más de 1 MB (límite del gateway) da **500**, cuando debería dar 413. El x-request-id sí está presente.
4. **X24 / H12:** con PUT y baja simultáneos, en **9 de 10** intentos el vehículo quedó dado de baja *con* la edición aplicada. Dos PUT simultáneos producen una actualización perdida: gana el último y no hay control de versión.
5. **X33 / H08:** desde `workorders-db` se lee `inventory-db` sin credenciales, y `vehicles-service`, que no usa Redis, recibe `+PONG` de Redis. La separación es lógica, no de red.
6. **X27:** de 5 refresh simultáneos del mismo token se acepta 1, y la detección de reutilización revoca la sesión entera. Es seguro, pero un cliente con dos pestañas que renuevan a la vez queda deslogueado.
7. **X13 / H03:** la reposición directa de una orden **EN_PROCESO** devuelve el stock y la orden sigue EN_PROCESO.
8. **E10 / K8:** tras un timeout, la orden queda con `reposicion: PENDIENTE` aunque inventory ya repuso. El stock está bien; el estado de la orden queda desfasado hasta que alguien reintenta.

---

## E01–E42 — Suites existentes

Primera corrida sobre el stack ya usado en las pruebas de carga: 41 PASS y E40 en FAIL, por un artefacto (el laboratorio estaba apagado porque el script exporta `LAB_ENDPOINTS=true` pero no recrea inventory). Se repitió todo **desde volúmenes vacíos, con `LAB_ENDPOINTS=true` y `JWT_EXPIRES_IN=5m`**: las tres suites dieron exit 0 y la revisión caso por caso queda así.

| ID | Sección | Estado | Observado (resumen) | Observación |
|---|---|---|---|---|
| E01 | tp6/00-docker | PASS | Docker 29.9.3, Compose 5.7.0, hello-world | — |
| E02 | tp6/01-build-individual | PASS | build OK; `/health` 503 degraded con `mongo:down` | — |
| E03 | tp6/02-compose-up | PASS | 10 contenedores healthy | — |
| E04 | tp6/03-health | PASS | 200 ok con dependencias up | — |
| E05 | tp6/04-crud | PASS | 200/201, 400, 404, 409; **baja 200 lógica** | El histórico mostraba 204 |
| E06 | tp6/05-comunicacion | PASS | 201; mismo rid en 4 servicios | — |
| E07 | tp6/06-propiedad-datos | PASS | cada servicio ve solo su base y su URI | lógico, no de red (ver X33) |
| E08 | tp6/07-persistencia | PASS | down sin -v + up: el mismo documento | — |
| E09 | tp6/08-fallo-dependencia | PASS | 503 controlado, sin orden registrada; recupera | — |
| E10 | tp6/09-fallo-parcial | PASS | 409 FALLIDA; bujías REPUESTO y stock 8; con timeout, INCIERTO | Notas del script desactualizadas (dicen «8 → 7»). Estado de la orden desfasado, como en K8 |
| E11 | tp6/10-logs | PASS | INFO/WARN/ERROR visibles | — |
| E12 | tp6/11-swagger | PASS | UI + 4 specs | — |
| E13 | tp6/12-datos-prueba | PASS | semilla 8/1/4; `--todo` limpia | — |
| E14 | tp7/00-arranque | PASS | healthy, login accesible | — |
| E15 | tp7/A-registro | PASS | alta ADMIN 201; register 404 | — |
| E16 | tp7/B-duplicado | PASS | 409 (también con mayúsculas) | — |
| E17 | tp7/C-login-valido | PASS | 200, access (300 s) + refresh | En la 1ª corrida eran 900 s por el `.env` (hallazgo 1) |
| E18 | tp7/D-login-invalido | PASS | 401 genérico | El 403 de cuenta inactiva **no está en la suite**: cubierto por **X04** |
| E19 | tp7/E-sin-token | PASS | 401 + www-authenticate; stock sin token 401 | — |
| E20 | tp7/F-token-modificado | PASS | payload alterado, `alg=none` y otra clave → 401 | — |
| E21 | tp7/G-token-vencido | PASS | 401 a los 7 s; config restaurada | — |
| E22 | tp7/H-rol-insuficiente | PASS | 403 por rol y por propiedad | — |
| E23 | tp7/I-rol-autorizado | PASS | 200/201 según contrato | — |
| E24 | tp7/J-propagacion | PASS | sub y rid propagados; llamada interna sin token → 401 | — |
| E25 | tp7/K-reinicio | PASS | usuario persiste, login 200 | — |
| E26 | tp7/L-hash-persistido | PASS | `$2b$12$…`, sin texto plano | — |
| E27 | tp7/M-auth-no-disponible | PASS | login 503; JWT vigente sigue operando | — |
| E28 | tp7/N-swagger | PASS | bearerAuth, 401/403 documentados | — |
| E29 | tp7/O-secretos | PASS | 0 secretos en archivos y logs | El script imprime el refresh completo en C y K: se enmascaró en la copia |
| E30 | correcciones/00-arranque | PASS | 10 healthy | — |
| E31 | correcciones/01-alta-administrada | PASS | 201/400/409/401/403; register 404 | — |
| E32 | correcciones/02-sesion-renovable | PASS | rotación; reuso, logout e inactividad → 401 | — |
| E33 | correcciones/03-vehiculos | PASS | normalización 409; baja lógica; inactivo → 409 en orden | — |
| E34 | correcciones/04-stock-autenticado | PASS | 401 / 200 | — |
| E35 | correcciones/05-inventario | PASS | 201/200, 400, 409 negativo, 403 | — |
| E36 | correcciones/06-cancelacion | PASS | CANCELADA + COMPLETA; ajeno 403; 2ª cancelación 409 | — |
| E37 | correcciones/07-fallo-parcial | PASS | 409 FALLIDA; bujías repuestas, **stock 8** | — |
| E38 | correcciones/08-estados | PASS | transiciones válidas; incompatibles 409 | — |
| E39 | correcciones/09-historial | PASS | soloLectura; ajena 403 | `propia=true` no aparece en la evidencia; X03 lo cubre por el lado `false` |
| E40 | correcciones/10-carrera-y-laboratorio | PASS | sin lock 200/200 → **−1**; con lock 409/200 → 0; reintento `repetido:true`; tardío 409; lab apagado 404 | En la 1ª corrida fue FAIL por artefacto (lab apagado) |
| E41 | correcciones/11-reposicion-inventory-caido | PASS | CANCELADA/PENDIENTE → COMPLETA; reintento 409 | — |
| E42 | correcciones/12-metricas | PASS | JSON + formato Prometheus | El mismo endpoint aparece con dos claves (`POST /:id/cancelar` y `/api/ordenes/:id/cancelar`) |

---

## X01–X35 — Pruebas adicionales

| ID | Prio | Estado | Observado | Hallazgo | Evidencia |
|---|---|---|---|---|---|
| X01 | P0 | **PASS** | volúmenes vacíos → `up --build` healthy en **19 s**; 10 contenedores; 5 specs con 200; semilla 3+3+admin; único WARN «sin certificado: HTTPS deshabilitado» | — | `X01-instalacion-desde-cero.txt` |
| X02 | P0 | **PASS** | MECANICO: orden ×1 → 201 EN_PROCESO → FINALIZADA; 2ª orden cancelada → reposición COMPLETA, stock +1; libro coherente | — | `X02-X10-ensayo-doble.txt` |
| X03 | P0 | **PASS** | 30/30 filas de rol/ruta/propiedad (4 APIs, sin token, token basura, A/B/ADMIN) | rutas directas: X20/X21 | `X03-…txt` |
| X04 | P0 | **PASS** | 12/12: register 404, 201, dup 409, 400; inactivo con clave correcta **403**, incorrecta 401; refresh revocado; access previo 200 hasta exp; reactivación | H07 | `X04-…txt` |
| X05 | P0 | **PASS** | 24/24 validaciones (dueño, patente normalizada, ids, cantidades 0/−1/1,5/«2», ajuste); 1 sola orden creada (la válida); stock sin escrituras parciales | — | `X05-…txt` |
| X06 | P0 | **PASS** | con `JWT_EXPIRES_IN=6s`: rotación, reuso → 401 y revocación de la sesión, logout → refresh 401, access 200 hasta exp y 401 después | H07; **`.env` = 15m** | `X06-…txt` |
| X07 | P0 | **PASS** | down sin -v + up (E08, E25) y restart completo (K9): los mismos conteos, sin semillas duplicadas | — | K9, E08, E25 |
| X08 | P0 | **PASS** | 2 ítems con el 2º insuficiente → FALLIDA y el 1º repuesto (E37); inventory caído → CANCELADA/PENDIENTE → COMPLETA, reintento 409 sin doble suma (E41, K7) | — | E37, E41, K7 |
| X09 | P0 | **PASS** | 200/400/401/403/409 con x-request-id; el rid de una orden aparece en 4/4 servicios; `/metrics/servicios` 200; **0 secretos** en logs | — | `X09-…txt` |
| X10 | P0 | **PASS** | ensayo ×2 idéntico; lab apagado → 404; invariantes OK sobre los datos de la demo | — | `X02-X10-ensayo-doble.txt` |
| X11 | P1 | **PASS** | stock 1, 2 a la vez: 1 OK y 1 «ocupado»; stock 5 con 30 clientes que reintentan: **exactamente 5 OK**, stock 0, nunca negativo | — | C4, C5 |
| X12 | P1 | **PASS** | secuencial: `repetido:true`, stock sin cambio; 5 concurrentes iguales: 1×200 y 4×409; **1 solo DESCUENTO** | (usa ordenId inexistente → H03) | `X12-…txt` |
| X13 | P1 | **PASS** | 3 reposiciones simultáneas → **1 sola REPOSICION**, stock +4 exacto | repone una orden EN_PROCESO (H03) | `X13-…txt` |
| X14 | P1 | **REPRO** | mismo POST ×2 → **2 órdenes**, stock −2; simultáneos: 201 + 409 (queda una FALLIDA extra) | H15 | `R-H15-…txt` |
| X15 | P1 | **REPRO** | cancelar a los 400 ms del POST → CANCELADA, NO_REQUERIDA, libro `[DESCUENTO -3]`, stock 10→7; reintento de reposición 409 | **H02** | `R-H02-…txt` |
| X16 | P1 | **REPRO** | TTL 300 ms con sección crítica de 1 s: A 201, B 201, **stock −1**; control con TTL 8 s: B 409, stock 0 | **H04** | `R-H04-…txt` |
| X17 | P1 | **PARCIAL** | control: validador de Mongo rechaza el movimiento → **el `$inc` se revierte**, stock = libro (el cliente recibe 500 genérico). Las variantes «reversión fallida» y «caída antes del catch» necesitan instrumentar el código → BLOQUEADA | H01 | `X17-…txt` |
| X18 | P1 | **REPRO** | SIGKILL a workorders durante el descuento → orden **PENDIENTE para siempre**, libro `[DESCUENTO -2]`; cancelarla **no** repone | **H05** | `K6-…txt` |
| X19 | P1 | **PARCIAL** | timeout del cliente con escritura aplicada → ítem **INCIERTO** y la reposición consulta el libro, stock correcto (K8, E10). Reset o timeout *al leer el cuerpo* necesita un proxy → BLOQUEADA | H06 | `K8-…txt` |
| X20 | P1 | **REPRO** | MECANICO, `descontar` con ordenId inexistente → **200**, stock 10→6 | **H03** | `R-H03-…txt` |
| X21 | P1 | **REPRO** | A repone su orden **FINALIZADA** → 200, stock +2; B (ajeno) → 403 (X03): la propiedad se valida, el ciclo de vida no | **H03** | `R-H03-…txt`, X03 |
| X22 | P1 | **PASS** | Redis caído: health `degraded`, orden con repuesto → 503 sin descuento, ingreso 503, lecturas 200; al volver, 201 e invariantes OK. Variante «reinicio durante el lock» → BLOQUEADA | — | `K3-…txt` |
| X23 | P1 | **PASS** | cada Mongo caído: lectura y escritura 503, **otros dominios 200**; primera lectura OK a 2,4 s (vehicles) y 1,2 s (inventory, auth) de levantarlo; sin escrituras fantasma | — | `X23-…txt`, K5 |
| X24 | P1 | **FAIL** (vehículo) | orden: finalizar vs cancelar ×5 → siempre 200 + 409, libro coherente. Vehículo: **actualización perdida**; **9/10** quedaron dados de baja con la edición aplicada | **H12** | `X24-…txt` |
| X25 | P1 | **BLOQUEADA** | requiere inyectar fallas en la creación de índices o en la semilla. Visto en X01: arranque limpio sin errores | H11/H20 | — |
| X26 | P1 | **FAIL** | ingreso 2⁵³+1 → **200**, stock 9007199254741002; cuerpo > 100 KB → **500**; > 1 MB → **500**; JSON malformado 400; 11 ítems 400 | H19, H16 | `X26-…txt` |
| X27 | P1 | **PASS** | 5 refresh simultáneos → 1 aceptado y la sesión se revoca por reutilización; degradar ADMIN→MECANICO: el access viejo **sigue siendo ADMIN (200)** hasta exp y el refresh emite el rol nuevo (403) | H07 | `X27-…txt` |
| X28 | P2 | **PASS** | 1–10 usuarios: 0 errores, p95 18–44 ms | — | C1 |
| X29 | P2 | **PASS** | repuestos distintos: 0 conflictos, ~130 órdenes/s; el mismo repuesto: 99/100 «ocupado» (delay 1 s); invariantes OK | — | C3, C4 |
| X30 | P2 | **PASS** (medición) | lectura: meseta en ~600 req/s, 0 errores con 1000 usuarios, cuello en el gateway; login: ~1,8/s y 503 desde 50 simultáneos. Corrió en un stack descartable, más allá de las guardas sugeridas | — | C1, C2 |
| X31 | P2 | **PASS** | `mongodump` de inventory → `mongorestore` en un Mongo nuevo: repuestos, stock y libro idénticos. Solo un dominio: 4 dumps separados no son un punto consistente | H13 (parcial) | `X31-…txt` |
| X32 | P2 | **PASS** (obs.) | solo el gateway publica puertos. **No hay certificado** → HTTPS deshabilitado: si se quiere mostrar, `bash services/api-gateway/scripts/generar-certificado.sh` | H09 | `X32-…txt` |
| X33 | P2 | **FAIL** | desde `workorders-db` se lee `inventory-db` sin auth; `vehicles-service` → Redis `+PONG` | **H08** | `X33-…txt` |
| X34 | P2 | **PASS** | `npm audit --omit=dev` en los 5 servicios: **0 vulnerabilidades** (la auditoría no había podido consultar el registro); ningún `.env` ni clave versionados; secreto actual en la historia: 0 | — | `X34-…txt` |
| X35 | P2 | **PARCIAL** | hay automatización con aserciones e invariantes (`plan-x.mjs`, `ensayo-demo.mjs`, `carreras.mjs`, `caos.mjs`, `carga.mjs`), pero no es una suite de regresión en CI ni independiente del orden. No se midió cobertura | — | `scripts/defensa/` |

---

## Reglas de integridad de la sección 6

Se verificaron con `invariantes()` (stock = suma del libro, stock ≥ 0, libro neto coherente con el estado de cada orden, sin PENDIENTE huérfanas) después de cada carga y prueba de caos. Dio **OK en todos los casos**, salvo los que reproducen defectos a propósito: H02 (cancelada con neto −3), H04 (stock −1) y H05 (PENDIENTE huérfana). Los detectó solo.

## Cómo repetir

```bash
GATEWAY_HTTP_PORT=3100 GATEWAY_HTTPS_PORT=3543 docker compose -p torque-defensa up --build -d --wait
node scripts/defensa/plan-x.mjs            # X03 X04 X05 X06 X09 X12 X13 X23 X24 X26 X27 X31 X32 X33 X34
node scripts/defensa/carreras.mjs          # X14 X15 X16 X20 X21
node scripts/defensa/caos.mjs              # X07 X08 X18 X19 X22 X23
node scripts/defensa/carga.mjs             # X11 X28 X29 X30
node scripts/defensa/ensayo-demo.mjs       # X02 X10
# Suites existentes, aisladas: desde una copia (worktree) con .env propio con
#   COMPOSE_PROJECT_NAME=torque-defensa, GATEWAY_HTTP_PORT=3100, JWT_EXPIRES_IN=5m
#   LAB_ENDPOINTS=true docker compose up -d --wait && GW=http://localhost:3100 bash scripts/pruebas-correcciones.sh
```
