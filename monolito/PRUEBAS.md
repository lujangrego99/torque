# Pruebas TP4 — Raft

Base: tres nodos corriendo (`npm run start:node1|2|3`), MongoDB y Redis disponibles.

## A — Arranque y Leader

```bash
curl -s http://127.0.0.1:3100/api/raft/status
curl -s http://127.0.0.1:3101/api/raft/status
curl -s http://127.0.0.1:3102/api/raft/status
```

Esperado: un único `role: "LEADER"` y dos `FOLLOWER`; mismo `currentTerm` / `leaderId`.

## B — Escritura sobre follower

Identificar un follower (p.ej. node2) y:

```bash
curl -s -X POST http://127.0.0.1:3101/api/vehiculos \
  -H 'content-type: application/json' \
  -d '{"marca":"X","modelo":"Y","anio":2020,"patente":"FF111GG","kilometraje":1}'
```

Esperado: **503** con `leader` (id + URL). La DB del follower no agrega el vehículo.

## C — CRUD sobre Leader

Sustituir `LEADER_PORT` (3100/3101/3102 según status):

```bash
curl -s -X POST http://127.0.0.1:LEADER_PORT/api/vehiculos \
  -H 'content-type: application/json' \
  -d '{"marca":"Ford","modelo":"Focus","anio":2019,"patente":"RAFT01A","kilometraje":40000}'

curl -s http://127.0.0.1:3100/api/vehiculos
curl -s http://127.0.0.1:3101/api/vehiculos
curl -s http://127.0.0.1:3102/api/vehiculos
```

Esperado: mismo `id`/`patente` en las tres listas tras commit.

PUT y DELETE análogos sobre el Leader; verificar convergencia.

## D — Caída del Leader

1. Anotar Leader.
2. Detener ese proceso (Ctrl+C).
3. Consultar status de los dos restantes hasta ver nuevo Leader.

Esperado: nueva elección; término ≥ al anterior.

## E — Quorum 2/3

Con Leader + 1 follower activos, POST un vehículo nuevo.  
Esperado: 201 y entrada en ambos logs (`/api/raft/log`) con `committed: true`.

## F — Sin quorum 1/3

Dejar un solo nodo. Intentar POST.  
Esperado: timeout / **503** “No se alcanzó quorum…”. La entrada puede existir localmente en el Leader pero **no** committed (ver log: `committed: false`) y no debe considerarse estado definitivo en las otras réplicas.

## G — Follower atrasado

1. Detener un follower.
2. Crear 1–2 vehículos con los dos nodos restantes.
3. Reiniciar el follower.
4. `GET /api/raft/log` y listados: el atrasado recupera entradas.

## H — Restart completo

1. Confirmar varias entradas committed.
2. Detener los tres procesos.
3. Reiniciar `start:node1|2|3` (sin borrar Mongo).
4. Esperar elección.
5. Verificar: término no retrocede; log y vehículos committed siguen.

## I — Redis + Raft

```bash
# En el Leader (id del filtro seed: ver GET /api/repuestos)
curl -s -X POST http://127.0.0.1:LEADER_PORT/api/repuestos/ID/descontar \
  -H 'content-type: application/json' \
  -d '{"cantidad":1}'
```

Lanzar dos descuentos concurrentes: uno obtiene el lock; la modificación aceptada queda en el log Raft y converge.

## Smoke automático

```bash
npm run pruebas:raft
```
