# torque

Gestión de taller mecánico — proyecto grupal de **Programación Distribuida** (UCH).

Repositorio **único y evolutivo** para el TP5 (análisis y diseño de microservicios) y los TPs siguientes. No se crea un repo nuevo por entrega: se marcan con tags (`tp5-entrega`, `tp6-entrega`, …).

## Integrantes

| Nombre | GitHub |
|---|---|
| Gregorio Luján | [@lujangrego99](https://github.com/lujangrego99) |
| Manuel Moya | [@ManusMoya](https://github.com/ManusMoya) |
| Jan Lahorca | [@janlahorca](https://github.com/janlahorca) |
| Agustín Martínez | [@AgustinEMCE](https://github.com/AgustinEMCE) |

Docentes colaboradores: `alvarezadriel@uch.edu.ar`, `cortezedgardo@uch.edu.ar`.

## ¿Qué hay hoy?

| Ruta | Contenido |
|---|---|
| `monolito/` | Versión funcional de partida: API del **TP3** (Express + Mongo + Redis + HTTPS + Winston + Swagger). **Sin Raft.** |
| `docs/arquitectura.md` | Análisis de responsabilidades, acoplamientos, fichas de microservicios, matrices y checklist (TP5) |
| `docs/diagrama-arquitectura.md` | Diagramas Mermaid de la arquitectura propuesta |
| `docs/TP05-Entrega-Campus.pdf` | Resumen para subir al campus (URL, integrantes, checklist) |

> El TP4 (Raft) fue un ejercicio individual de consenso sobre el mismo dominio. Para partir en microservicios estorba (réplica del monolito entero), así que la base compartida del grupo es el TP3.

## Microservicios propuestos (etapa de diseño)

1. **`vehicles-service`** — parque de vehículos (CRUD + patente única).  
2. **`inventory-service`** — stock de repuestos y descuento concurrente (Redis).  
3. **`api-gateway`** — TLS, enrutamiento y Swagger agregado.

La implementación de la separación queda para TPs posteriores.

## Arranque del monolito (punto de partida)

```bash
cd monolito
cp .env.example .env
npm install
# MongoDB en :27017 y Redis en :6379
# Certificado: bash scripts/generar-certificado.sh  (o el .ps1 en Windows)
npm start
```

- HTTP `http://localhost:3000`
- HTTPS `https://localhost:3443` (`curl -k`)
- Swagger `http://localhost:3000/api-docs`

Detalle: `monolito/README.md`.

## Flujo de Git

- Rama principal: `main`.  
- Trabajo en ramas (`feature/…`, `docs/…`, `fix/…`) + **Pull Request**.  
- Commits con mensaje concreto (qué cambió).  
- Entrega TP5: tag `tp5-entrega`.

```bash
git clone git@github.com:lujangrego99/torque.git
cd torque
git switch -c feature/mi-tarea
# … cambios …
git push -u origin HEAD
gh pr create
```

## Variables sensibles

No versionar `.env`, claves, certificados privados, `node_modules` ni logs. Ver `.gitignore` y `monolito/.env.example`.
