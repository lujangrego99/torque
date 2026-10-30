// Contrato OpenAPI 3 de vehicles-service. Es la interfaz pública que usan
// api-gateway y workorders-service (nadie accede a la base del servicio).
const { aplicarSeguridad } = require("./seguridad");
const ejemploId = "68c000000000000000000001";

const error = (descripcion, ejemplo) => ({
  description: descripcion,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: ejemplo } },
});

const r400 = error("Datos inválidos", {
  error: "Datos inválidos o incompletos.",
  detalles: ["La patente debe tener entre 6 y 8 caracteres alfanuméricos."],
});
const r404 = error("Vehículo inexistente", { error: "Vehículo no encontrado." });
const r409 = error("Patente duplicada", {
  error: "Conflicto de integridad.",
  detalles: ["Ya existe un vehículo con esa patente."],
});
const r503 = error("MongoDB no disponible", {
  error: "Servicio no disponible.",
  detalles: ["La base de datos de vehicles-service no está disponible."],
});

const parametroId = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
  example: ejemploId,
};

// Matriz de acceso (TP7). Todo el recurso requiere identidad; la baja, ADMIN.
const ACCESO = {
  "GET /api/vehiculos": ["MECANICO", "ADMIN"],
  "POST /api/vehiculos": ["MECANICO", "ADMIN"],
  "GET /api/vehiculos/{id}": ["MECANICO", "ADMIN"],
  "PUT /api/vehiculos/{id}": ["MECANICO", "ADMIN"],
  "DELETE /api/vehiculos/{id}": ["ADMIN"],
};

module.exports = aplicarSeguridad({
  openapi: "3.0.3",
  info: {
    title: "vehicles-service",
    version: "1.0.0",
    description: "Parque de vehículos del taller (TP7 · torque). Dueño exclusivo de la colección `vehiculos`.",
  },
  servers: [{ url: "/" }],
  tags: [{ name: "Vehículos" }, { name: "Salud" }],
  paths: {
    "/health": {
      get: {
        tags: ["Salud"],
        summary: "Estado del servicio y de su base",
        responses: {
          200: { description: "Disponible", content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } } },
          503: { description: "Proceso vivo pero MongoDB no disponible", content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } } },
        },
      },
    },
    "/api/vehiculos": {
      get: {
        tags: ["Vehículos"],
        summary: "Listar vehículos",
        responses: {
          200: { description: "Listado", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Vehiculo" } } } } },
          503: r503,
        },
      },
      post: {
        tags: ["Vehículos"],
        summary: "Alta de vehículo",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/VehiculoEntrada" } } },
        },
        responses: {
          201: { description: "Creado", content: { "application/json": { schema: { $ref: "#/components/schemas/Vehiculo" } } } },
          400: r400,
          409: r409,
          503: r503,
        },
      },
    },
    "/api/vehiculos/{id}": {
      parameters: [parametroId],
      get: {
        tags: ["Vehículos"],
        summary: "Obtener un vehículo (también lo usa workorders-service para validar la referencia)",
        responses: {
          200: { description: "Encontrado", content: { "application/json": { schema: { $ref: "#/components/schemas/Vehiculo" } } } },
          400: r400,
          404: r404,
          503: r503,
        },
      },
      put: {
        tags: ["Vehículos"],
        summary: "Reemplazo completo",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/VehiculoEntrada" } } },
        },
        responses: {
          200: { description: "Actualizado", content: { "application/json": { schema: { $ref: "#/components/schemas/Vehiculo" } } } },
          400: r400,
          404: r404,
          409: r409,
          503: r503,
        },
      },
      delete: {
        tags: ["Vehículos"],
        summary: "Baja",
        responses: { 204: { description: "Eliminado" }, 400: r400, 404: r404, 503: r503 },
      },
    },
  },
  components: {
    schemas: {
      VehiculoEntrada: {
        type: "object",
        required: ["marca", "modelo", "anio", "patente", "kilometraje"],
        properties: {
          marca: { type: "string", maxLength: 60, example: "Fiat" },
          modelo: { type: "string", maxLength: 60, example: "Cronos" },
          anio: { type: "integer", minimum: 1900, example: 2022 },
          patente: { type: "string", pattern: "^[A-Z0-9]{6,8}$", example: "AE111ZZ" },
          kilometraje: { type: "integer", minimum: 0, example: 15000 },
        },
      },
      Vehiculo: {
        allOf: [
          { type: "object", properties: { id: { type: "string", example: ejemploId } } },
          { $ref: "#/components/schemas/VehiculoEntrada" },
        ],
      },
      Error: {
        type: "object",
        properties: { error: { type: "string" }, detalles: { type: "array", items: { type: "string" } } },
      },
      Health: {
        type: "object",
        properties: {
          service: { type: "string", example: "vehicles-service" },
          status: { type: "string", enum: ["ok", "degraded"] },
          dependencias: { type: "object", example: { mongo: "up" } },
        },
      },
    },
  },
}, ACCESO);
