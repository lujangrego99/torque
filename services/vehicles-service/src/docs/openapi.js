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
const r409 = error("Patente ya cargada: se devuelve el vehículo existente para usarlo", {
  error: "Vehículo ya registrado.",
  detalles: ["La patente AB123CD ya está cargada. Usar el vehículo existente."],
  vehiculoExistente: {
    id: ejemploId,
    marca: "Toyota",
    modelo: "Corolla",
    anio: 2018,
    patente: "AB123CD",
    kilometraje: 95000,
    duenio: { nombre: "Laura Gómez", telefono: "261 555-0101" },
    activo: true,
  },
});
const r409Inactivo = error("Vehículo dado de baja (no se modifica)", {
  error: "Vehículo dado de baja.",
  detalles: ["Un vehículo inactivo no se modifica. Un ADMIN puede reactivarlo."],
});
const vehiculo = (descripcion) => ({ description: descripcion, content: { "application/json": { schema: { $ref: "#/components/schemas/Vehiculo" } } } });
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

// Matriz de acceso. Todo el recurso requiere identidad; baja y reactivación, ADMIN.
const ACCESO = {
  "GET /api/vehiculos": ["MECANICO", "ADMIN"],
  "POST /api/vehiculos": ["MECANICO", "ADMIN"],
  "GET /api/vehiculos/patente/{patente}": ["MECANICO", "ADMIN"],
  "GET /api/vehiculos/{id}": ["MECANICO", "ADMIN"],
  "PUT /api/vehiculos/{id}": ["MECANICO", "ADMIN"],
  "DELETE /api/vehiculos/{id}": ["ADMIN"],
  "POST /api/vehiculos/{id}/reactivar": ["ADMIN"],
};

module.exports = aplicarSeguridad({
  openapi: "3.0.3",
  info: {
    title: "vehicles-service",
    version: "2.0.0",
    description: [
      "Parque de vehículos del taller (torque). Dueño exclusivo de la colección `vehiculos`.",
      "",
      "- Una patente es un auto: si ya está cargada, el alta responde **409 con `vehiculoExistente`** para usarlo en la orden nueva.",
      "- Cada vehículo guarda **nombre y teléfono del dueño** (obligatorios).",
      "- La baja es **lógica**: el vehículo queda `activo: false`, conserva su historial y no admite órdenes nuevas.",
      "- El historial de órdenes del auto está en workorders-service: `GET /api/ordenes/vehiculo/{vehiculoId}`.",
    ].join("\n"),
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
        summary: "Listar vehículos (por defecto, solo activos)",
        parameters: [
          { name: "patente", in: "query", schema: { type: "string" }, description: "Buscar un auto por patente (incluye inactivos)" },
          { name: "incluirInactivos", in: "query", schema: { type: "boolean", default: false } },
        ],
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
          201: vehiculo("Creado"),
          400: r400,
          409: r409,
          503: r503,
        },
      },
    },
    "/api/vehiculos/patente/{patente}": {
      get: {
        tags: ["Vehículos"],
        summary: "Buscar por patente (¿el auto ya está cargado?)",
        parameters: [{ name: "patente", in: "path", required: true, schema: { type: "string" }, example: "AB123CD" }],
        responses: { 200: vehiculo("Encontrado (activo o no)"), 404: r404, 503: r503 },
      },
    },
    "/api/vehiculos/{id}/reactivar": {
      parameters: [parametroId],
      post: {
        tags: ["Vehículos"],
        summary: "Reactivar un vehículo dado de baja",
        responses: { 200: vehiculo("Activo"), 400: r400, 404: r404, 503: r503 },
      },
    },
    "/api/vehiculos/{id}": {
      parameters: [parametroId],
      get: {
        tags: ["Vehículos"],
        summary: "Obtener un vehículo, aunque esté dado de baja (lo usa workorders-service para validar la referencia)",
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
          409: { description: "Patente de otro vehículo o vehículo dado de baja", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, examples: { duplicada: { value: r409.content["application/json"].example }, inactivo: { value: r409Inactivo.content["application/json"].example } } } } },
          503: r503,
        },
      },
      delete: {
        tags: ["Vehículos"],
        summary: "Baja lógica (queda inactivo y conserva su historial; idempotente)",
        requestBody: {
          required: false,
          content: { "application/json": { schema: { type: "object", properties: { motivo: { type: "string" } } }, example: { motivo: "El dueño vendió el auto" } } },
        },
        responses: { 200: vehiculo("Dado de baja (activo: false)"), 400: r400, 404: r404, 503: r503 },
      },
    },
  },
  components: {
    schemas: {
      VehiculoEntrada: {
        type: "object",
        required: ["marca", "modelo", "anio", "patente", "kilometraje", "duenio"],
        properties: {
          marca: { type: "string", maxLength: 60, example: "Fiat" },
          modelo: { type: "string", maxLength: 60, example: "Cronos" },
          anio: { type: "integer", minimum: 1900, example: 2022 },
          patente: { type: "string", pattern: "^[A-Z0-9]{6,8}$", example: "AE111ZZ" },
          kilometraje: { type: "integer", minimum: 0, example: 15000 },
          duenio: {
            type: "object",
            required: ["nombre", "telefono"],
            properties: {
              nombre: { type: "string", example: "Pedro Díaz" },
              telefono: { type: "string", example: "261 555-0199" },
            },
          },
        },
      },
      Vehiculo: {
        allOf: [
          { type: "object", properties: { id: { type: "string", example: ejemploId } } },
          { $ref: "#/components/schemas/VehiculoEntrada" },
          {
            type: "object",
            properties: {
              activo: { type: "boolean", example: true },
              baja: { type: "object", properties: { fecha: { type: "string", format: "date-time" }, por: { type: "string" }, motivo: { type: "string" } } },
            },
          },
        ],
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          detalles: { type: "array", items: { type: "string" } },
          vehiculoExistente: { type: "object", description: "Solo en el 409 por patente ya cargada" },
        },
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
