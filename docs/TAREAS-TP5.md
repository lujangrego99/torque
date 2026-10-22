# Tareas TP5 — puesta en común

Repo: https://github.com/lujangrego99/torque  
El análisis se armó en puesta en común del grupo. La documentación quedó centralizada en `docs/`.

## Integrantes

| Nombre | GitHub |
|---|---|
| Gregorio Luján | `lujangrego99` |
| Manuel Moya | `ManusMoya` |
| Jan Lahorca | `janlahorca` |
| Agustín Martínez | `AgustinEMCE` |

## Documentos

| Archivo | Contenido |
|---|---|
| `arquitectura.md` | Visión completa |
| `01-inventario-y-responsabilidades.md` | Inventario + responsabilidades |
| `02-acoplamientos-y-microservicios.md` | Acoplamientos + fichas |
| `03-datos-comunicaciones-checklist.md` | Datos, comunicaciones, CU, checklist |
| `diagrama-arquitectura.md` | Diagramas Mermaid |
| `ENTREGABLES.md` | Seguimiento §14 |

## Microservicios acordados

1. `vehicles-service`  
2. `inventory-service`  
3. `api-gateway`  

Base: `monolito/` = TP3 (sin Raft).

## Cierre

```bash
git tag tp5-entrega
git push origin tp5-entrega
```
