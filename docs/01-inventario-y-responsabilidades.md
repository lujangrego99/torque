# Inventario y responsabilidades

**TP5 · torque** · Grupo

Inventario de la API e identificación de responsabilidades.

---

## 4. Inventario de la aplicación actual

| Funcionalidad / endpoint | Responsabilidad actual | Datos utilizados | Dependencias |
|---|---|---|---|
| `GET /api/vehiculos` | Listar parque de vehículos | `vehiculos` (Mongo) | — |
| `GET /api/vehiculos/:id` | Obtener un vehículo | `vehiculos` | — |
| `POST /api/vehiculos` | Alta de vehículo | marca, modelo, año, patente, km | Validación + Mongo |
| `PUT /api/vehiculos/:id` | Reemplazo completo | mismos campos + id | Idem. + unicidad de patente |
| `DELETE /api/vehiculos/:id` | Baja | id | Mongo |
| `GET /api/repuestos` | Listar stock | `repuestos` | — |
| `GET /api/repuestos/:id` | Obtener repuesto | `repuestos` | — |
| `GET /api/repuestos/:id/lock` | Diagnosticar lock | Redis `lock:repuesto:{id}` | Redis |
| `POST /api/repuestos/:id/descontar-sin-lock` | Demo carrera (check-then-act) | stock | Sin Redis; puede oversell |
| `POST /api/repuestos/:id/descontar` | Descontar stock con exclusión mutua | stock, cantidad | Redis lock → Mongo |
| `POST /api/repuestos/reiniciar` | Reset demo de stock | seeds de repuestos | Seed / Mongo |
| `GET /api-docs` (+ `.json`) | Documentación OpenAPI | spec generada | Toda la API |
| HTTPS / Winston / seed | Arranque, logs, datos iniciales | `.env`, certs, logs | Mongo + Redis |

Reglas de negocio vigentes:

- Patente única (conflicto → 409).
- Validación de campos de vehículo (tipos, rangos, formato de patente).
- Stock insuficiente → 409 en el camino con lock; el camino sin lock existe a propósito para demo de carrera.
- Si Redis no está, el descuento con lock responde 503.
---

## 5. Identificación de responsabilidades

### R1 — Gestión del parque de vehículos

1. **Problema**: registrar y mantener los vehículos que el taller atiende.  
2. **Operaciones**: listar, obtener, alta, actualización, baja.  
3. **Reglas**: validación de campos; unicidad de patente.  
4. **Necesita**: datos del vehículo.  
5. **Crea/modifica**: colección `vehiculos`.  
6. **Conoce**: hoy no necesita repuestos.  
7. **Cambian juntos**: altas/bajas/edición de flota y reglas de patente.  
8. **Independiente**: sí, respecto del stock.

### R2 — Gestión de inventario de repuestos

1. **Problema**: saber qué hay en stock y descontar sin corrupción concurrente.  
2. **Operaciones**: listar, consultar, descontar (con/sin lock), reiniciar demo, inspeccionar lock.  
3. **Reglas**: cantidad positiva; stock insuficiente → 409; exclusión mutua en descuento seguro.  
4. **Necesita**: id de repuesto, stock, configuración de lock.  
5. **Crea/modifica**: `repuestos.stock` (y seeds).  
6. **Conoce**: hoy no necesita vehículos.  
7. **Cambian juntos**: política de stock, TTL de lock, demos de concurrencia.  
8. **Independiente**: sí, respecto de la flota.

### R3 — Acceso unificado y borde de la API

1. **Problema**: un solo punto de entrada para clientes (TLS, rutas, docs).  
2. **Operaciones**: terminar HTTPS, enrutar a servicios, exponer Swagger agregado, health.  
3. **Reglas**: enrutamiento; no posee reglas de patente ni de stock.  
4. **Necesita**: ubicaciones de los servicios.  
5. **Crea/modifica**: ningún dato de negocio.  
6. **Conoce**: contratos públicos de vehículos e inventario.  
7. **Cambian juntos**: certificados, paths públicos, agregación de docs.  
8. **Independiente**: sí; es borde, no dominio.

---

