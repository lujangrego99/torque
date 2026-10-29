// Contrato propio del gateway (salud y documentación). Las rutas de negocio
// están documentadas en el spec de cada servicio dueño (/api-docs, selector arriba).
module.exports = {
  openapi: "3.0.3",
  info: {
    title: "api-gateway",
    version: "1.0.0",
    description: [
      "Punto de entrada único de torque (TP6). Termina HTTPS, enruta por prefijo y agrega la documentación.",
      "",
      "| Prefijo público | Servicio dueño |",
      "|---|---|",
      "| `/api/vehiculos` | vehicles-service |",
      "| `/api/repuestos` | inventory-service |",
      "| `/api/ordenes` | workorders-service |",
      "",
      "Las respuestas de los servicios (incluidos sus 4xx/5xx) se devuelven sin modificar.",
      "Si el servicio dueño no responde (timeout, DNS, conexión rechazada) el gateway responde **503** con `servicio` y `causa`.",
    ].join("\n"),
  },
  servers: [{ url: "/" }],
  tags: [{ name: "Salud" }],
  paths: {
    "/health": {
      get: {
        tags: ["Salud"],
        summary: "Salud del gateway (proceso vivo)",
        responses: { 200: { description: "OK", content: { "application/json": { example: { service: "api-gateway", status: "ok" } } } } },
      },
    },
    "/health/servicios": {
      get: {
        tags: ["Salud"],
        summary: "Salud agregada de los servicios internos",
        responses: {
          200: { description: "Todos ok" },
          503: {
            description: "Algún servicio caído o degradado",
            content: {
              "application/json": {
                example: {
                  service: "api-gateway",
                  status: "degraded",
                  servicios: {
                    "vehicles-service": { httpStatus: 200, service: "vehicles-service", status: "ok", dependencias: { mongo: "up" } },
                    "inventory-service": { status: "down", causa: "dns" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/{recurso}": {
      parameters: [{ name: "recurso", in: "path", required: true, schema: { type: "string", enum: ["vehiculos", "repuestos", "ordenes"] } }],
      get: {
        tags: ["Salud"],
        summary: "Proxy hacia el servicio dueño (ver specs de cada servicio)",
        responses: {
          503: {
            description: "El servicio dueño no respondió",
            content: {
              "application/json": {
                example: {
                  error: "Servicio no disponible.",
                  servicio: "inventory-service",
                  causa: "dns",
                  detalles: ["inventory-service no respondió (dns: ENOTFOUND). Reintentar más tarde."],
                },
              },
            },
          },
        },
      },
    },
  },
};
