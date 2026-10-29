// Contrato OpenAPI 3 de inventory-service. Es la interfaz pública que usan
// api-gateway y workorders-service (nadie accede a la base ni al Redis del servicio).
const ejemploId = "68c000000000000000000012";

const error = (descripcion, ejemplo) => ({
  description: descripcion,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: ejemplo } },
});

const r400 = error("Datos inválidos", {
  error: "Datos inválidos o incompletos.",
  detalles: ["El campo cantidad debe ser un entero positivo."],
});
const r404 = error("Repuesto inexistente", { error: "Repuesto no encontrado." });
const r409 = error("Stock insuficiente o recurso ocupado (lock tomado)", {
  error: "Stock insuficiente.",
  detalles: ["Stock disponible de FIL-ACE-001: 0, solicitado: 1."],
  item: { id: "68c000000000000000000011", nombre: "Filtro de aceite", codigo: "FIL-ACE-001", stock: 0 },
});
const r503Mongo = error("MongoDB no disponible", {
  error: "Servicio no disponible.",
  detalles: ["La base de datos de inventory-service no está disponible."],
});
const r503Redis = error("Redis/Memurai o MongoDB no disponible", {
  error: "No se pudo coordinar el acceso al recurso.",
  detalles: ["Redis/Memurai no está disponible."],
});

const parametroId = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
  example: ejemploId,
};

const cuerpoCantidad = {
  required: false,
  content: {
    "application/json": {
      schema: { type: "object", properties: { cantidad: { type: "integer", minimum: 1, default: 1, example: 1 } } },
    },
  },
};

const respuestaDescuento = {
  description: "Stock descontado",
  content: { "application/json": { schema: { $ref: "#/components/schemas/Descuento" } } },
};

module.exports = {
  openapi: "3.0.3",
  info: {
    title: "inventory-service",
    version: "1.0.0",
    description:
      "Stock de repuestos y descuento concurrente (TP6 · torque). Dueño exclusivo de la colección `repuestos` y de los locks `lock:repuesto:{id}` en Redis.",
  },
  servers: [{ url: "/" }],
  tags: [{ name: "Repuestos" }, { name: "Concurrencia" }, { name: "Salud" }],
  paths: {
    "/health": {
      get: {
        tags: ["Salud"],
        summary: "Estado del servicio, su base y Redis",
        description: "200 si MongoDB está disponible (status `degraded` si Redis está caído). 503 si MongoDB no está.",
        responses: {
          200: { description: "Disponible", content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } } },
          503: { description: "MongoDB no disponible", content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } } },
        },
      },
    },
    "/api/repuestos": {
      get: {
        tags: ["Repuestos"],
        summary: "Listar repuestos y stock",
        responses: {
          200: { description: "Listado", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Repuesto" } } } } },
          503: r503Mongo,
        },
      },
    },
    "/api/repuestos/reiniciar": {
      post: {
        tags: ["Repuestos"],
        summary: "Restaurar el stock a la semilla (estado inicial conocido para las pruebas)",
        responses: { 200: { description: "Stock restaurado" }, 503: r503Mongo },
      },
    },
    "/api/repuestos/{id}": {
      parameters: [parametroId],
      get: {
        tags: ["Repuestos"],
        summary: "Obtener un repuesto",
        responses: {
          200: { description: "Encontrado", content: { "application/json": { schema: { $ref: "#/components/schemas/Repuesto" } } } },
          400: r400,
          404: r404,
          503: r503Mongo,
        },
      },
    },
    "/api/repuestos/{id}/lock": {
      parameters: [parametroId],
      get: {
        tags: ["Concurrencia"],
        summary: "Diagnóstico del lock en Redis",
        responses: { 200: { description: "Estado del lock" }, 400: r400, 503: r503Redis },
      },
    },
    "/api/repuestos/{id}/descontar": {
      parameters: [parametroId],
      post: {
        tags: ["Concurrencia"],
        summary: "Descontar stock con lock Redis (camino seguro; lo usa workorders-service)",
        requestBody: cuerpoCantidad,
        responses: { 200: respuestaDescuento, 400: r400, 404: r404, 409: r409, 503: r503Redis },
      },
    },
    "/api/repuestos/{id}/descontar-sin-lock": {
      parameters: [parametroId],
      post: {
        tags: ["Concurrencia"],
        summary: "Descontar sin lock (demo de condición de carrera del TP2)",
        requestBody: cuerpoCantidad,
        responses: { 200: respuestaDescuento, 400: r400, 404: r404, 409: r409, 503: r503Mongo },
      },
    },
  },
  components: {
    schemas: {
      Repuesto: {
        type: "object",
        properties: {
          id: { type: "string", example: ejemploId },
          nombre: { type: "string", example: "Pastillas de freno delanteras" },
          codigo: { type: "string", example: "PAS-FRE-001" },
          stock: { type: "integer", example: 4 },
        },
      },
      Descuento: {
        type: "object",
        properties: {
          mensaje: { type: "string", example: "Stock descontado." },
          item: { $ref: "#/components/schemas/Repuesto" },
          proteccion: { type: "boolean", example: true },
          lock: { type: "string", example: "lock:repuesto:68c000000000000000000012" },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          detalles: { type: "array", items: { type: "string" } },
          item: { $ref: "#/components/schemas/Repuesto" },
        },
      },
      Health: {
        type: "object",
        properties: {
          service: { type: "string", example: "inventory-service" },
          status: { type: "string", enum: ["ok", "degraded"] },
          dependencias: { type: "object", example: { mongo: "up", redis: "up" } },
        },
      },
    },
  },
};
