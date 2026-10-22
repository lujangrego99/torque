# Diagrama de arquitectura — torque (TP5)

Herramienta: Mermaid (renderiza en GitHub y en la mayoría de visores Markdown).

## Vista de servicios

```mermaid
flowchart LR
  Client[Cliente / Postman / cURL]

  subgraph edge [Borde]
    GW["api-gateway\nTLS · routing · Swagger"]
  end

  subgraph domain [Dominio]
    VS["vehicles-service\nParque de vehículos"]
    IS["inventory-service\nStock y concurrencia"]
  end

  subgraph data [Persistencia por dueño]
    M1[(Mongo vehicles)]
    M2[(Mongo inventory)]
    R[(Redis locks)]
  end

  Client --> GW
  GW -->|HTTP /api/vehiculos| VS
  GW -->|HTTP /api/repuestos| IS
  VS --> M1
  IS --> M2
  IS --> R
```

## Casos de uso

### Alta de vehículo

```mermaid
sequenceDiagram
  participant C as Cliente
  participant G as api-gateway
  participant V as vehicles-service
  participant M as Mongo vehicles
  C->>G: POST /api/vehiculos
  G->>V: POST /api/vehiculos
  V->>V: validar + unicidad patente
  V->>M: insert
  M-->>V: ok
  V-->>G: 201
  G-->>C: 201 + cuerpo
```

### Descontar stock (camino seguro)

```mermaid
sequenceDiagram
  participant C as Cliente
  participant G as api-gateway
  participant I as inventory-service
  participant R as Redis
  participant M as Mongo inventory
  C->>G: POST /api/repuestos/:id/descontar
  G->>I: POST .../descontar
  I->>R: SET NX lock
  alt lock ok
    I->>M: leer stock / $inc
    I->>R: release lock
    I-->>G: 200 o 409
  else Redis caído
    I-->>G: 503
  end
  G-->>C: respuesta
```

La justificación completa está en [arquitectura.md](./arquitectura.md).
