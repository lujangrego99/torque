// Contrato propio del gateway (salud y documentación). Las rutas de negocio
// están documentadas en el spec de cada servicio dueño (/api-docs, selector arriba).
module.exports = {
  openapi: "3.0.3",
  info: {
    title: "api-gateway",
    version: "1.0.0",
    description: [
      "Punto de entrada único de torque. Termina HTTPS, enruta por prefijo y agrega la documentación y las métricas.",
      "",
      "| Prefijo público | Servicio dueño |",
      "|---|---|",
      "| `/api/vehiculos` | vehicles-service |",
      "| `/api/repuestos` | inventory-service |",
      "| `/api/ordenes` | workorders-service |",
      "| `/api/auth` | auth-service |",
      "",
      "**Seguridad (TP7):** el header `Authorization: Bearer <token>` se reenvía sin modificar. El gateway no valida el JWT:",
      "lo valida cada servicio dueño (firma HS256, emisor, audiencia y vencimiento) y responde 401/403.",
      "Para probar: elegir *auth-service (login)* en el selector → `POST /api/auth/login` → **Authorize** con el `accessToken`.",
      "El access token vence a los 5 minutos: renovarlo con `POST /api/auth/refresh` y el `refreshToken`.",
      "",
      "Las respuestas de los servicios (incluidos sus 4xx/5xx) se devuelven sin modificar.",
      "Si el servicio dueño no responde (timeout, DNS, conexión rechazada) el gateway responde **503** con `servicio` y `causa`.",
    ].join("\n"),
  },
  servers: [{ url: "/" }],
  tags: [{ name: "Salud" }, { name: "Métricas" }],
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
    "/metrics": {
      get: {
        tags: ["Métricas"],
        summary: "Métricas del gateway: pedidos, errores y tiempos por prefijo",
        parameters: [{ name: "formato", in: "query", schema: { type: "string", enum: ["json", "prometheus"] } }],
        responses: { 200: { description: "Métricas del proceso" } },
      },
    },
    "/metrics/servicios": {
      get: {
        tags: ["Métricas"],
        summary: "Métricas agregadas de todos los servicios (resumen ordenado por p95: el más lento primero)",
        responses: {
          200: {
            description: "Resumen + detalle por servicio",
            content: {
              "application/json": {
                example: {
                  resumen: [
                    { servicio: "workorders-service", pedidos: 30, errores5xx: 0, tasaError5xx: 0, p95Ms: 1056.5, promedioMs: 219.5 },
                    { servicio: "vehicles-service", pedidos: 20, errores5xx: 0, tasaError5xx: 0, p95Ms: 8.9, promedioMs: 4.6 },
                  ],
                },
              },
            },
          },
        },
      },
    },
    "/api/{recurso}": {
      parameters: [{ name: "recurso", in: "path", required: true, schema: { type: "string", enum: ["vehiculos", "repuestos", "ordenes", "auth"] } }],
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
