# TP N° 4 — Consenso Raft (taller)

API REST del taller mecánico evolucionada a un **cluster fijo de 3 nodos** con Raft educativo (Programación Distribuida, UCH).

Parte del TP3: HTTPS, MongoDB/Mongoose, Winston, Swagger, Redis (solo lock).  
Nuevo: elección de Leader, heartbeats, log replicado, quorum/commit, State Machine, persistencia Raft y recuperación.

## Requisitos

- Node.js ≥ 18 (recomendado 20)
- MongoDB en `127.0.0.1:27017` (tres bases: `taller_node1`, `taller_node2`, `taller_node3`)
- Redis/Memurai en `6379` (para `POST .../descontar`)
- Certificado HTTPS (scripts en `scripts/`)

## Instalación

```bash
cd TP04-Consenso-Raft
cp .env.example .env
npm install
bash scripts/generar-certificado.sh   # o .ps1 en Windows
```

## Arranque de los tres nodos

Sin editar código: solo cambiar `NODE_ID` (o usar los scripts).

```bash
# Tres terminales
npm run start:node1
npm run start:node2
npm run start:node3
```

| Nodo  | HTTP | HTTPS | Raft | Mongo DB       |
|-------|------|-------|------|----------------|
| node1 | 3100 | 3443  | 7001 | taller_node1   |
| node2 | 3101 | 3444  | 7002 | taller_node2   |
| node3 | 3102 | 3445  | 7003 | taller_node3   |

Diagnóstico:

```bash
curl -s http://127.0.0.1:3100/api/raft/status | jq
curl -s http://127.0.0.1:3101/api/raft/status | jq
curl -s http://127.0.0.1:3102/api/raft/status | jq
```

Swagger: `http://localhost:3100/api-docs` (y puertos 3101/3102).

## Comportamiento clave

- **GET** vehículos/repuestos: lectura local (sin consenso).
- **POST/PUT/DELETE** vehículos: solo en el **Leader** → append log → quorum → State Machine → Mongo local de cada nodo.
- Escritura a un **follower**: **503** con `leaderId` y URLs del Leader (no se aplica local).
- **Descontar** (`POST /api/repuestos/:id/descontar`): lock Redis → comando Raft → commit. Redis no elige Leader.
- RPC internos (`http://localhost:700x/raft/...`): solo protocolo; no usarlos como prueba de negocio.

## Smoke test

```bash
npm run pruebas:raft
```

## Documentación del TP

- `PRUEBAS.md` — secuencia de escenarios A–I
- `RESPUESTAS.md` — preguntas de control + Paxos vs Raft
- `Enunciado-TP04.pdf`

## Entrega

Incluir código, `package.json` / lock, `.env.example`, README, Swagger, evidencias.  
**No** incluir: `node_modules/`, `.env`, claves/certificados reales, logs voluminosos.
