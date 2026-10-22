# Tareas por integrante — TP5

Repo: https://github.com/lujangrego99/torque  
Flujo: **rama → commit → Pull Request → merge a `main`**.  
No trabajar directo sobre `main`.

## Reparto

| Integrante | GitHub | Rama | Archivo a agregar | Entregables del enunciado |
|---|---|---|---|---|
| Gregorio Luján | `lujangrego99` | (ya en historial + este doc) | Repo, monolito TP3, `arquitectura.md`, diagrama, `ENTREGABLES.md` | 1–6 (base colaborativa) + marco del análisis |
| Manuel Moya | `ManusMoya` | `docs/manu-inventario` | `docs/01-inventario-y-responsabilidades.md` | 7–8 inventario + responsabilidades |
| Jan Lahorca | `janlahorca` | `docs/jan-acoplamientos-servicios` | `docs/02-acoplamientos-y-microservicios.md` | 9–11 acoplamientos + microservicios + fichas |
| Agustín Martínez | `AgustinEMCE` | `docs/agus-datos-comunicaciones` | `docs/03-datos-comunicaciones-checklist.md` | 12–16 datos, comunicaciones, CU, diagrama ref., checklist |

## Microservicios acordados

1. `vehicles-service` — parque de vehículos  
2. `inventory-service` — stock + locks Redis  
3. `api-gateway` — TLS, routing, Swagger  

Base de código: `monolito/` = **TP3** (sin Raft).

## Docentes

- `AdrielAlvarez` invitado  
- `cortezedgardo@uch.edu.ar` → invitar por mail en Settings → Collaborators  

## Al cerrar la etapa

```bash
git tag tp5-entrega
git push origin tp5-entrega
```
