// Contrato OpenAPI 3 de workorders-service.
const { aplicarSeguridad } = require("./seguridad");
const error = (descripcion, ejemplo) => ({
  description: descripcion,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: ejemplo } },
});

const ordenFallida = (descripcion, ejemplo) => ({
  description: descripcion,
  content: { "application/json": { schema: { $ref: "#/components/schemas/OrdenFallida" }, example: ejemplo } },
});

// Matriz de acceso (TP7). Todo requiere identidad; además, regla de propiedad:
// un MECANICO solo lista/consulta las órdenes que creó (ADMIN, todas).
const ACCESO = {
  "GET /api/ordenes": ["MECANICO", "ADMIN"],
  "POST /api/ordenes": ["MECANICO", "ADMIN"],
  "GET /api/ordenes/{id}": ["MECANICO", "ADMIN"],
};

module.exports = aplicarSeguridad({
  openapi: "3.0.3",
  info: {
    title: "workorders-service",
    version: "1.0.0",
    description: [
      "Órdenes de trabajo del taller (TP7 · torque). Dueño exclusivo de la colección `ordenes`.",
      "Para crear una orden consulta **vehicles-service** (`GET /api/vehiculos/:id`) e **inventory-service**",
      "(`GET /api/repuestos/:id` y `POST /api/repuestos/:id/descontar`) por HTTP. Guarda solo referencias lógicas (ids).",
      "",
      "Semántica de errores: 404/409 del remoto son errores funcionales y se propagan; timeout, DNS, conexión",
      "rechazada o 503 del remoto → **503**; otro 5xx del remoto → **502**.",
    ].join("\n"),
  },
  servers: [{ url: "/" }],
  tags: [{ name: "Órdenes" }, { name: "Salud" }],
  paths: {
    "/health": {
      get: {
        tags: ["Salud"],
        summary: "Estado del servicio y de su base (no depende de los servicios remotos)",
        responses: {
          200: { description: "Disponible", content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } } },
          503: { description: "MongoDB no disponible", content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } } },
        },
      },
    },
    "/api/ordenes": {
      get: {
        tags: ["Órdenes"],
        summary: "Listar órdenes",
        description: "Un MECANICO recibe solo las órdenes que creó; ADMIN recibe todas.",
        parameters: [
          { name: "estado", in: "query", schema: { type: "string", enum: ["PENDIENTE", "CONFIRMADA", "FALLIDA"] } },
          { name: "vehiculoId", in: "query", schema: { type: "string" } },
        ],
        responses: {
          200: { description: "Listado", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Orden" } } } } },
          400: error("Filtro inválido", { error: "Datos inválidos o incompletos.", detalles: ["estado debe ser uno de: PENDIENTE, CONFIRMADA, FALLIDA."] }),
          503: error("MongoDB no disponible", { error: "Servicio no disponible.", detalles: ["La base de datos de workorders-service no está disponible."] }),
        },
      },
      post: {
        tags: ["Órdenes"],
        summary: "Crear orden de trabajo (valida vehículo, valida repuestos y descuenta stock)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OrdenEntrada" },
              examples: {
                ok: {
                  summary: "Service de frenos (OK con stock semilla)",
                  value: {
                    vehiculoId: "68c000000000000000000001",
                    descripcion: "Cambio de pastillas delanteras",
                    repuestos: [{ repuestoId: "68c000000000000000000012", cantidad: 2 }],
                  },
                },
                falloParcial: {
                  summary: "Fallo parcial: bujías OK y filtro sin stock (correr después de agotar el filtro)",
                  value: {
                    vehiculoId: "68c000000000000000000002",
                    descripcion: "Service completo",
                    repuestos: [
                      { repuestoId: "68c000000000000000000013", cantidad: 4 },
                      { repuestoId: "68c000000000000000000011", cantidad: 1 },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Orden CONFIRMADA: todo el stock fue descontado", content: { "application/json": { schema: { $ref: "#/components/schemas/Orden" } } } },
          400: error("Entrada inválida", { error: "Datos inválidos o incompletos.", detalles: ["vehiculoId debe ser un ObjectId hexadecimal de 24 caracteres."] }),
          404: error("Vehículo o repuesto inexistente (informado por el servicio dueño); no se registra la orden", {
            error: "Vehículo no encontrado.",
            detalles: ["No existe el vehículo 68c000000000000000000099 en vehicles-service."],
          }),
          409: ordenFallida("Stock insuficiente o recurso ocupado en inventory-service; la orden queda FALLIDA", {
            error: "No se pudo completar la orden: conflicto de stock.",
            orden: { estado: "FALLIDA", requiereCompensacion: true },
          }),
          502: error("Un servicio dependiente respondió un 5xx inesperado", { error: "Error en un servicio dependiente.", detalles: ["inventory-service: error_remoto (HTTP 500)"] }),
          503: error("vehicles-service o inventory-service no disponible (timeout, DNS, conexión rechazada o 503)", {
            error: "Dependencia no disponible.",
            detalles: ["vehicles-service: dns (ENOTFOUND)", "No se pudo validar el vehículo. No se registró la orden."],
          }),
        },
      },
    },
    "/api/ordenes/{id}": {
      get: {
        tags: ["Órdenes"],
        summary: "Obtener una orden (incluye estado por ítem)",
        description: "Regla de propiedad: un MECANICO solo puede ver las órdenes que creó (`creadaPor` = `sub` de su token). ADMIN ve todas.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }],
        responses: {
          200: { description: "Encontrada", content: { "application/json": { schema: { $ref: "#/components/schemas/Orden" } } } },
          400: error("Id inválido", { error: "Datos inválidos o incompletos." }),
          403: error("MECANICO consultando una orden de otro usuario", { error: "Permisos insuficientes.", detalles: ["La orden pertenece a otro usuario."] }),
          404: error("Inexistente", { error: "Orden no encontrada." }),
        },
      },
    },
  },
  components: {
    schemas: {
      OrdenEntrada: {
        type: "object",
        required: ["vehiculoId", "descripcion"],
        properties: {
          vehiculoId: { type: "string", example: "68c000000000000000000001" },
          descripcion: { type: "string", example: "Cambio de pastillas delanteras" },
          repuestos: {
            type: "array",
            maxItems: 10,
            items: {
              type: "object",
              required: ["repuestoId"],
              properties: {
                repuestoId: { type: "string", example: "68c000000000000000000012" },
                cantidad: { type: "integer", minimum: 1, default: 1 },
              },
            },
          },
        },
      },
      Item: {
        type: "object",
        properties: {
          repuestoId: { type: "string" },
          codigo: { type: "string" },
          nombre: { type: "string" },
          cantidad: { type: "integer" },
          estado: { type: "string", enum: ["PENDIENTE", "DESCONTADO", "RECHAZADO", "INCIERTO", "NO_INTENTADO"] },
          detalle: { type: "string" },
        },
      },
      Orden: {
        type: "object",
        properties: {
          id: { type: "string" },
          vehiculoId: { type: "string" },
          patente: { type: "string", example: "AB123CD" },
          creadaPor: { type: "string", nullable: true, description: "sub del usuario que creó la orden (null en órdenes anteriores al TP7)", example: "6720f0c2a1b2c3d4e5f60718" },
          descripcion: { type: "string" },
          estado: { type: "string", enum: ["PENDIENTE", "CONFIRMADA", "FALLIDA"] },
          items: { type: "array", items: { $ref: "#/components/schemas/Item" } },
          falla: {
            type: "object",
            properties: { etapa: { type: "string" }, servicio: { type: "string" }, causa: { type: "string" }, detalle: { type: "string" } },
          },
          requiereCompensacion: { type: "boolean" },
          creadaEn: { type: "string", format: "date-time" },
          actualizadaEn: { type: "string", format: "date-time" },
        },
      },
      OrdenFallida: {
        type: "object",
        properties: { error: { type: "string" }, orden: { $ref: "#/components/schemas/Orden" } },
      },
      Error: {
        type: "object",
        properties: { error: { type: "string" }, detalles: { type: "array", items: { type: "string" } } },
      },
      Health: {
        type: "object",
        properties: {
          service: { type: "string", example: "workorders-service" },
          status: { type: "string", enum: ["ok", "degraded"] },
          dependencias: { type: "object", example: { mongo: "up" } },
        },
      },
    },
  },
}, ACCESO);
