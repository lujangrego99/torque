// Contrato OpenAPI 3 de inventory-service. Es la interfaz pública que usan
// api-gateway y workorders-service (nadie accede a la base ni al Redis del servicio).
const config = require("../config");
const { aplicarSeguridad } = require("./seguridad");
const ejemploId = "68c000000000000000000012";
const ejemploOrden = "6730a1b2c3d4e5f601234567";

const error = (descripcion, ejemplo) => ({
  description: descripcion,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: ejemplo } },
});
const json = (descripcion, schema, example) => ({
  description: descripcion,
  content: { "application/json": { schema, ...(example ? { example } : {}) } },
});
const ref = (nombre) => ({ $ref: `#/components/schemas/${nombre}` });
const cuerpo = (schema, example) => ({ required: true, content: { "application/json": { schema, example } } });

const r400 = error("Datos inválidos", {
  error: "Datos inválidos o incompletos.",
  detalles: ["El campo cantidad debe ser un entero positivo."],
});
const r404 = error("Repuesto inexistente", { error: "Repuesto no encontrado." });
const r409Descuento = error("Stock insuficiente, recurso ocupado (lock tomado) u orden ya repuesta", {
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

const conMovimiento = (descripcion) => json(descripcion, ref("ResultadoMovimiento"));

// Matriz de acceso. Todo requiere identidad (el stock es información interna).
// Alta, ingreso, ajuste: ADMIN. Consumo y reposición por órdenes: MECANICO o ADMIN.
const ACCESO = {
  "GET /api/repuestos": ["MECANICO", "ADMIN"],
  "POST /api/repuestos": ["ADMIN"],
  "GET /api/repuestos/movimientos": ["MECANICO", "ADMIN"],
  "GET /api/repuestos/{id}": ["MECANICO", "ADMIN"],
  "POST /api/repuestos/{id}/ingreso": ["ADMIN"],
  "POST /api/repuestos/{id}/ajuste": ["ADMIN"],
  "POST /api/repuestos/{id}/descontar": ["MECANICO", "ADMIN"],
  "POST /api/repuestos/reposiciones": ["MECANICO", "ADMIN"],
};

const paths = {
  "/health": {
    get: {
      tags: ["Salud"],
      summary: "Estado del servicio, su base y Redis",
      description: "200 si MongoDB está disponible (status `degraded` si Redis está caído). 503 si MongoDB no está.",
      responses: {
        200: json("Disponible", ref("Health")),
        503: json("MongoDB no disponible", ref("Health")),
      },
    },
  },
  "/api/repuestos": {
    get: {
      tags: ["Repuestos"],
      summary: "Listar repuestos y stock",
      responses: { 200: json("Listado", { type: "array", items: ref("Repuesto") }), 503: r503Mongo },
    },
    post: {
      tags: ["Repuestos"],
      summary: "Alta de repuesto (código único; el stock inicial entra como INGRESO)",
      requestBody: cuerpo(ref("RepuestoEntrada"), { nombre: "Radiador Corolla", codigo: "RAD-COR-001", stock: 2 }),
      responses: {
        201: conMovimiento("Creado"),
        400: r400,
        409: error("Código duplicado", { error: "Conflicto de integridad.", detalles: ["Ya existe un repuesto con ese código."] }),
        503: r503Mongo,
      },
    },
  },
  "/api/repuestos/movimientos": {
    get: {
      tags: ["Movimientos"],
      summary: "Libro de movimientos (ADMIN: todos · MECANICO: los que generó)",
      parameters: [
        { name: "repuestoId", in: "query", schema: { type: "string" } },
        { name: "ordenId", in: "query", schema: { type: "string" }, description: "Todo lo que descontó y repuso una orden" },
        { name: "tipo", in: "query", schema: { type: "string", enum: ["INGRESO", "AJUSTE", "DESCUENTO", "REPOSICION"] } },
        { name: "limite", in: "query", schema: { type: "integer", default: 100, maximum: 500 } },
      ],
      responses: { 200: json("Movimientos, el más reciente primero", { type: "array", items: ref("Movimiento") }), 400: r400 },
    },
  },
  "/api/repuestos/reposiciones": {
    post: {
      tags: ["Movimientos"],
      summary: "Reponer lo que descontó una orden (contramovimiento; idempotente)",
      description: [
        "Devuelve al stock exactamente lo que el libro registra como DESCUENTO de esa orden, con un movimiento REPOSICION por repuesto.",
        "Repetir la llamada no vuelve a sumar (`YA_REPUESTO`). `repuestoIds` agrega repuestos cuyo descuento quedó incierto (timeout):",
        "se consulta el libro bajo el lock y, si no se aplicó, se deja una reposición de 0 que bloquea un descuento tardío.",
        "Puede reponer quien hizo los descuentos (dueño de la orden) o un ADMIN.",
      ].join(" "),
      requestBody: cuerpo(
        {
          type: "object",
          required: ["ordenId"],
          properties: {
            ordenId: { type: "string" },
            repuestoIds: { type: "array", items: { type: "string" } },
            motivo: { type: "string" },
          },
        },
        { ordenId: ejemploOrden, motivo: "Orden cancelada" }
      ),
      responses: {
        200: json("Reposición procesada", ref("Reposicion")),
        400: r400,
        403: error("Los descuentos los hizo otro usuario", { error: "Permisos insuficientes.", detalles: ["Los descuentos de esa orden los hizo otro usuario."] }),
        409: error("Lock ocupado por demasiado tiempo", { error: "Recurso ocupado." }),
        503: r503Redis,
      },
    },
  },
  "/api/repuestos/{id}": {
    parameters: [parametroId],
    get: {
      tags: ["Repuestos"],
      summary: "Obtener un repuesto",
      responses: { 200: json("Encontrado", ref("Repuesto")), 400: r400, 404: r404, 503: r503Mongo },
    },
  },
  "/api/repuestos/{id}/ingreso": {
    parameters: [parametroId],
    post: {
      tags: ["Movimientos"],
      summary: "Ingreso de mercadería (suma stock)",
      requestBody: cuerpo(
        { type: "object", required: ["cantidad"], properties: { cantidad: { type: "integer", minimum: 1 }, motivo: { type: "string" } } },
        { cantidad: 5, motivo: "Remito 0001-00012345" }
      ),
      responses: { 200: conMovimiento("Ingreso registrado"), 400: r400, 404: r404, 503: r503Redis },
    },
  },
  "/api/repuestos/{id}/ajuste": {
    parameters: [parametroId],
    post: {
      tags: ["Movimientos"],
      summary: "Ajuste por error de conteo (con signo, exige motivo)",
      requestBody: cuerpo(
        {
          type: "object",
          required: ["cantidad", "motivo"],
          properties: { cantidad: { type: "integer", description: "Corrección con signo, distinta de 0" }, motivo: { type: "string", minLength: 5 } },
        },
        { cantidad: -1, motivo: "Conteo físico: una unidad dañada" }
      ),
      responses: {
        200: conMovimiento("Ajuste registrado"),
        400: error("Sin motivo o cantidad 0", { error: "Datos inválidos o incompletos.", detalles: ["El ajuste exige un motivo (mínimo 5 caracteres)."] }),
        404: r404,
        409: error("El ajuste dejaría el stock negativo", { error: "Ajuste inválido." }),
        503: r503Redis,
      },
    },
  },
  "/api/repuestos/{id}/descontar": {
    parameters: [parametroId],
    post: {
      tags: ["Concurrencia"],
      summary: "Descontar stock para una orden, con lock Redis (lo usa workorders-service)",
      description:
        "Registra un DESCUENTO ligado a `ordenId`. Idempotente por orden: si esa orden ya descontó este repuesto, devuelve el movimiento existente (`repetido: true`). Si la orden ya fue repuesta → 409.",
      requestBody: cuerpo(
        {
          type: "object",
          required: ["ordenId"],
          properties: { cantidad: { type: "integer", minimum: 1, default: 1 }, ordenId: { type: "string" } },
        },
        { cantidad: 1, ordenId: ejemploOrden }
      ),
      responses: { 200: conMovimiento("Stock descontado"), 400: r400, 404: r404, 409: r409Descuento, 503: r503Redis },
    },
  },
};

// Laboratorio (requisito 16): solo con LAB_ENDPOINTS=true.
if (config.labEndpoints) {
  Object.assign(ACCESO, {
    "POST /api/repuestos/reiniciar": ["ADMIN"],
    "GET /api/repuestos/{id}/lock": ["ADMIN"],
    "POST /api/repuestos/{id}/descontar-sin-lock": ["ADMIN"],
  });
  Object.assign(paths, {
    "/api/repuestos/reiniciar": {
      post: {
        tags: ["Laboratorio"],
        summary: "LABORATORIO: restaurar stock y movimientos a la semilla",
        responses: { 200: { description: "Stock restaurado" }, 503: r503Mongo },
      },
    },
    "/api/repuestos/{id}/lock": {
      parameters: [parametroId],
      get: {
        tags: ["Laboratorio"],
        summary: "LABORATORIO: diagnóstico del lock en Redis",
        responses: { 200: { description: "Estado del lock" }, 400: r400, 503: r503Redis },
      },
    },
    "/api/repuestos/{id}/descontar-sin-lock": {
      parameters: [parametroId],
      post: {
        tags: ["Laboratorio"],
        summary: "LABORATORIO: descontar sin lock (demo de la condición de carrera del TP2)",
        requestBody: cuerpo({ type: "object", properties: { cantidad: { type: "integer", minimum: 1, default: 1 } } }, { cantidad: 1 }),
        responses: { 200: conMovimiento("Stock descontado"), 400: r400, 404: r404, 409: r409Descuento, 503: r503Mongo },
      },
    },
  });
}

module.exports = aplicarSeguridad({
  openapi: "3.0.3",
  info: {
    title: "inventory-service",
    version: "2.0.0",
    description: [
      "Stock de repuestos (torque). Dueño exclusivo de las colecciones `repuestos` y `movimientos` y de los locks `lock:repuesto:{id}` en Redis.",
      "",
      "Cada cambio de stock deja una línea en el **libro de movimientos** (INGRESO, AJUSTE, DESCUENTO, REPOSICION) con usuario, fecha y orden asociada.",
      `Endpoints de laboratorio: **${config.labEndpoints ? "ACTIVOS (LAB_ENDPOINTS=true)" : "apagados"}**.`,
    ].join("\n"),
  },
  servers: [{ url: "/" }],
  tags: [{ name: "Repuestos" }, { name: "Movimientos" }, { name: "Concurrencia" }, ...(config.labEndpoints ? [{ name: "Laboratorio" }] : []), { name: "Salud" }],
  paths,
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
      RepuestoEntrada: {
        type: "object",
        required: ["nombre", "codigo"],
        properties: {
          nombre: { type: "string", maxLength: 80 },
          codigo: { type: "string", pattern: "^[A-Z0-9-]{5,20}$" },
          stock: { type: "integer", minimum: 0, default: 0, description: "Stock inicial (se registra como INGRESO)" },
        },
      },
      Movimiento: {
        type: "object",
        properties: {
          id: { type: "string" },
          fecha: { type: "string", format: "date-time" },
          tipo: { type: "string", enum: ["INGRESO", "AJUSTE", "DESCUENTO", "REPOSICION"] },
          repuestoId: { type: "string" },
          codigo: { type: "string" },
          cantidad: { type: "integer", description: "Variación con signo" },
          stockAnterior: { type: "integer" },
          stockResultante: { type: "integer" },
          usuario: { type: "string", description: "sub del token (\"sistema\" para la semilla)" },
          rol: { type: "string" },
          ordenId: { type: "string", nullable: true },
          motivo: { type: "string" },
        },
      },
      ResultadoMovimiento: {
        type: "object",
        properties: {
          mensaje: { type: "string" },
          item: ref("Repuesto"),
          movimiento: ref("Movimiento"),
          repetido: { type: "boolean" },
          proteccion: { type: "boolean" },
          lock: { type: "string" },
        },
      },
      Reposicion: {
        type: "object",
        properties: {
          ordenId: { type: "string" },
          unidadesRepuestas: { type: "integer" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                repuestoId: { type: "string" },
                codigo: { type: "string" },
                descontado: { type: "integer" },
                repuesto: { type: "integer" },
                estado: { type: "string", enum: ["REPUESTO", "YA_REPUESTO", "SIN_DESCUENTO", "REPUESTO_INEXISTENTE"] },
                stock: { type: "integer" },
              },
            },
          },
        },
      },
      Error: {
        type: "object",
        properties: { error: { type: "string" }, detalles: { type: "array", items: { type: "string" } }, item: ref("Repuesto") },
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
}, ACCESO);
