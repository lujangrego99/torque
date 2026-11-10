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

const orden = (descripcion) => ({ description: descripcion, content: { "application/json": { schema: { $ref: "#/components/schemas/Orden" } } } });
const parametroId = { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } };
const r403Propiedad = error("MECANICO operando sobre una orden de otro usuario", { error: "Permisos insuficientes.", detalles: ["La orden pertenece a otro usuario."] });
const r404 = error("Inexistente", { error: "Orden no encontrada." });

// Matriz de acceso. Todo requiere identidad; además, regla de propiedad:
// un MECANICO solo lista, consulta, edita, finaliza y cancela las órdenes que
// creó (ADMIN, todas). El historial del vehículo lo ve cualquiera (solo lectura).
const ACCESO = {
  "GET /api/ordenes": ["MECANICO", "ADMIN"],
  "POST /api/ordenes": ["MECANICO", "ADMIN"],
  "GET /api/ordenes/vehiculo/{vehiculoId}": ["MECANICO", "ADMIN"],
  "GET /api/ordenes/{id}": ["MECANICO", "ADMIN"],
  "PATCH /api/ordenes/{id}": ["MECANICO", "ADMIN"],
  "POST /api/ordenes/{id}/cancelar": ["MECANICO", "ADMIN"],
  "POST /api/ordenes/{id}/finalizar": ["MECANICO", "ADMIN"],
  "POST /api/ordenes/{id}/reponer": ["MECANICO", "ADMIN"],
};

module.exports = aplicarSeguridad({
  openapi: "3.0.3",
  info: {
    title: "workorders-service",
    version: "2.0.0",
    description: [
      "Órdenes de trabajo del taller (torque). Dueño exclusivo de la colección `ordenes`.",
      "Para crear una orden consulta **vehicles-service** (`GET /api/vehiculos/:id` o `/patente/:p`) e **inventory-service**",
      "(`GET /api/repuestos/:id` y `POST /api/repuestos/:id/descontar` con el `ordenId`) por HTTP. Guarda solo referencias lógicas (ids).",
      "",
      "Ciclo de vida: `PENDIENTE` → `EN_PROCESO` (repuestos asignados) → `FINALIZADA`. Desde PENDIENTE o EN_PROCESO se puede **cancelar**",
      "(dueño o ADMIN, con motivo) → `CANCELADA`. Si un descuento falla → `FALLIDA`. En CANCELADA y FALLIDA el stock descontado",
      "**vuelve automáticamente** al inventario con un contramovimiento ligado a la orden (`POST /api/repuestos/reposiciones`).",
      "",
      "Semántica de errores: 404/409 del remoto son errores funcionales y se propagan; timeout, DNS, conexión",
      "rechazada o 503 del remoto → **503**; otro 5xx del remoto → **502**.",
    ].join("\n"),
  },
  servers: [{ url: "/" }],
  tags: [{ name: "Órdenes" }, { name: "Ciclo de vida" }, { name: "Salud" }],
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
          { name: "estado", in: "query", schema: { type: "string", enum: ["PENDIENTE", "EN_PROCESO", "FINALIZADA", "CANCELADA", "FALLIDA"] } },
          { name: "vehiculoId", in: "query", schema: { type: "string" } },
        ],
        responses: {
          200: { description: "Listado", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Orden" } } } } },
          400: error("Filtro inválido", { error: "Datos inválidos o incompletos.", detalles: ["estado debe ser uno de: PENDIENTE, EN_PROCESO, FINALIZADA, CANCELADA, FALLIDA."] }),
          503: error("MongoDB no disponible", { error: "Servicio no disponible.", detalles: ["La base de datos de workorders-service no está disponible."] }),
        },
      },
      post: {
        tags: ["Órdenes"],
        summary: "Crear orden de trabajo (valida vehículo activo, valida repuestos y descuenta stock)",
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
                porPatente: {
                  summary: "Auto ya cargado: alcanza con la patente",
                  value: { patente: "AB123CD", descripcion: "Diagnóstico de ruido en tren delantero" },
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
          201: orden("Orden EN_PROCESO: todo el stock fue descontado"),
          400: error("Entrada inválida", { error: "Datos inválidos o incompletos.", detalles: ["vehiculoId debe ser un ObjectId hexadecimal de 24 caracteres."] }),
          404: error("Vehículo o repuesto inexistente (informado por el servicio dueño); no se registra la orden", {
            error: "Vehículo no encontrado.",
            detalles: ["No existe el vehículo 68c000000000000000000099 en vehicles-service."],
          }),
          409: ordenFallida("Stock insuficiente o recurso ocupado: la orden queda FALLIDA y lo descontado se repone solo (o vehículo dado de baja)", {
            error: "No se pudo completar la orden: conflicto de stock.",
            orden: { estado: "FALLIDA", requiereCompensacion: false, reposicion: { estado: "COMPLETA", unidades: 4 } },
          }),
          502: error("Un servicio dependiente respondió un 5xx inesperado", { error: "Error en un servicio dependiente.", detalles: ["inventory-service: error_remoto (HTTP 500)"] }),
          503: error("vehicles-service o inventory-service no disponible (timeout, DNS, conexión rechazada o 503)", {
            error: "Dependencia no disponible.",
            detalles: ["vehicles-service: dns (ENOTFOUND)", "No se pudo validar el vehículo. No se registró la orden."],
          }),
        },
      },
    },
    "/api/ordenes/vehiculo/{vehiculoId}": {
      get: {
        tags: ["Órdenes"],
        summary: "Historial del vehículo: TODAS sus órdenes, en solo lectura",
        description: "Cualquier usuario autenticado. `propia` indica cuáles puede editar o cancelar quien consulta.",
        parameters: [{ name: "vehiculoId", in: "path", required: true, schema: { type: "string" }, example: "68c000000000000000000001" }],
        responses: {
          200: { description: "Historial", content: { "application/json": { schema: { $ref: "#/components/schemas/Historial" } } } },
          400: error("Id inválido", { error: "Datos inválidos o incompletos." }),
        },
      },
    },
    "/api/ordenes/{id}": {
      parameters: [parametroId],
      get: {
        tags: ["Órdenes"],
        summary: "Obtener una orden (incluye estado por ítem e historial de estados)",
        description: "Regla de propiedad: un MECANICO solo puede ver las órdenes que creó (`creadaPor` = `sub` de su token). ADMIN ve todas.",
        responses: { 200: orden("Encontrada"), 400: error("Id inválido", { error: "Datos inválidos o incompletos." }), 403: r403Propiedad, 404: r404 },
      },
      patch: {
        tags: ["Órdenes"],
        summary: "Editar la descripción (dueño o ADMIN, orden abierta)",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { descripcion: { type: "string" } } }, example: { descripcion: "Cambio de pastillas y rectificado de discos" } } } },
        responses: { 200: orden("Editada"), 400: error("Descripción inválida", { error: "Datos inválidos o incompletos." }), 403: r403Propiedad, 404: r404, 409: error("Orden cerrada", { error: "La orden no se puede editar." }) },
      },
    },
    "/api/ordenes/{id}/cancelar": {
      parameters: [parametroId],
      post: {
        tags: ["Ciclo de vida"],
        summary: "Cancelar (dueño o ADMIN, con motivo) — repone el stock automáticamente",
        description: "Solo órdenes PENDIENTE o EN_PROCESO. Guarda motivo, quién y cuándo (`cancelacion`). Si inventory no responde, la orden queda CANCELADA con `reposicion.estado = PENDIENTE` (reintentar con /reponer).",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["motivo"], properties: { motivo: { type: "string", minLength: 5 } } }, example: { motivo: "El cliente decidió no hacer el trabajo" } } } },
        responses: {
          200: orden("CANCELADA (con reposición)"),
          400: error("Sin motivo", { error: "Datos inválidos o incompletos.", detalles: ["motivo es obligatorio (mínimo 5 caracteres)."] }),
          403: r403Propiedad,
          404: r404,
          409: error("Orden FINALIZADA, FALLIDA o ya CANCELADA", { error: "La orden no se puede cancelar.", detalles: ["Estado actual: FINALIZADA. Solo se cancelan órdenes PENDIENTE o EN_PROCESO."] }),
        },
      },
    },
    "/api/ordenes/{id}/finalizar": {
      parameters: [parametroId],
      post: {
        tags: ["Ciclo de vida"],
        summary: "Finalizar (dueño o ADMIN): EN_PROCESO → FINALIZADA",
        responses: { 200: orden("FINALIZADA"), 403: r403Propiedad, 404: r404, 409: error("No está EN_PROCESO", { error: "La orden no se puede finalizar." }) },
      },
    },
    "/api/ordenes/{id}/reponer": {
      parameters: [parametroId],
      post: {
        tags: ["Ciclo de vida"],
        summary: "Reintentar una reposición que quedó PENDIENTE (idempotente)",
        responses: { 200: orden("Reposición reintentada"), 403: r403Propiedad, 404: r404, 409: error("Sin reposición pendiente", { error: "No hay reposición pendiente." }) },
      },
    },
  },
  components: {
    schemas: {
      OrdenEntrada: {
        type: "object",
        required: ["descripcion"],
        description: "Indicar `vehiculoId` o `patente` (no ambos).",
        properties: {
          vehiculoId: { type: "string", example: "68c000000000000000000001" },
          patente: { type: "string", example: "AB123CD" },
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
          estado: { type: "string", enum: ["PENDIENTE", "DESCONTADO", "RECHAZADO", "INCIERTO", "NO_INTENTADO", "REPUESTO", "NO_APLICADO"] },
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
          propia: { type: "boolean", description: "Solo en el historial del vehículo" },
          estado: { type: "string", enum: ["PENDIENTE", "EN_PROCESO", "FINALIZADA", "CANCELADA", "FALLIDA"] },
          items: { type: "array", items: { $ref: "#/components/schemas/Item" } },
          cancelacion: {
            type: "object",
            properties: { motivo: { type: "string" }, por: { type: "string" }, rol: { type: "string" }, fecha: { type: "string", format: "date-time" } },
          },
          finalizacion: { type: "object", properties: { por: { type: "string" }, fecha: { type: "string", format: "date-time" } } },
          reposicion: {
            type: "object",
            properties: {
              estado: { type: "string", enum: ["NO_REQUERIDA", "COMPLETA", "PENDIENTE"] },
              unidades: { type: "integer" },
              fecha: { type: "string", format: "date-time" },
              detalle: { type: "string" },
              intentos: { type: "integer" },
            },
          },
          historial: {
            type: "array",
            items: { type: "object", properties: { estado: { type: "string" }, fecha: { type: "string", format: "date-time" }, por: { type: "string" }, detalle: { type: "string" } } },
          },
          falla: {
            type: "object",
            properties: { etapa: { type: "string" }, servicio: { type: "string" }, causa: { type: "string" }, detalle: { type: "string" } },
          },
          requiereCompensacion: { type: "boolean" },
          creadaEn: { type: "string", format: "date-time" },
          actualizadaEn: { type: "string", format: "date-time" },
        },
      },
      Historial: {
        type: "object",
        properties: {
          vehiculoId: { type: "string" },
          patente: { type: "string" },
          soloLectura: { type: "boolean", example: true },
          ordenes: { type: "array", items: { $ref: "#/components/schemas/Orden" } },
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
