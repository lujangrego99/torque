const IDS = require("./ids");

const spec = {
  openapi: "3.0.3",
  info: {
    title: "API REST de taller (Raft)",
    version: "4.0.0",
    description:
      "API del TP N° 4 de Programación Distribuida (UCH). Cluster de 3 nodos con Raft educativo. Las escrituras de vehículos pasan por log/commit/State Machine. Redis solo protege la sección crítica del descuento; no elige Leader ni hace commit. Los RPC internos (/raft/* en puerto 700x) no son API de negocio.",
  },
  tags: [
    { name: "Vehículos", description: "GET local. POST/PUT/DELETE solo en el Leader (vía Raft)." },
    {
      name: "Repuestos",
      description: "Descontar: lock Redis + comando Raft. GET local.",
    },
    { name: "Raft", description: "Diagnóstico del nodo (no modificar el protocolo desde acá)." },
  ],
  servers: [
    { url: "http://localhost:3100", description: "node1 HTTP" },
    { url: "http://localhost:3101", description: "node2 HTTP" },
    { url: "http://localhost:3102", description: "node3 HTTP" },
    { url: "https://localhost:3443", description: "node1 HTTPS" },
  ],
  components: {
    schemas: {
      Vehiculo: {
        type: "object",
        required: ["id", "marca", "modelo", "anio", "patente", "kilometraje"],
        properties: {
          id: {
            type: "string",
            pattern: "^[a-fA-F0-9]{24}$",
            description: "ObjectId generado por MongoDB.",
            example: IDS.corolla,
          },
          marca: { type: "string", example: "Toyota" },
          modelo: { type: "string", example: "Corolla" },
          anio: { type: "integer", example: 2018, minimum: 1900 },
          patente: { type: "string", example: "AB123CD" },
          kilometraje: { type: "integer", example: 95000, minimum: 0 },
        },
      },
      VehiculoInput: {
        type: "object",
        required: ["marca", "modelo", "anio", "patente", "kilometraje"],
        properties: {
          marca: { type: "string", example: "Honda" },
          modelo: { type: "string", example: "Civic" },
          anio: { type: "integer", example: 2020, minimum: 1900 },
          patente: { type: "string", example: "AE111BB" },
          kilometraje: { type: "integer", example: 30000, minimum: 0 },
        },
      },
      Repuesto: {
        type: "object",
        required: ["id", "nombre", "codigo", "stock"],
        properties: {
          id: { type: "string", example: IDS.filtro },
          nombre: { type: "string", example: "Filtro de aceite" },
          codigo: { type: "string", example: "FIL-ACE-001" },
          stock: { type: "integer", example: 1 },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          detalles: { type: "array", items: { type: "string" } },
        },
      },
      DescuentoInput: {
        type: "object",
        properties: {
          cantidad: { type: "integer", minimum: 1, default: 1, example: 1 },
        },
      },
    },
    parameters: {
      VehiculoId: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
        example: IDS.corolla,
        description: "ObjectId del vehículo.",
      },
      RepuestoId: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
        example: IDS.filtro,
        description: "ObjectId del repuesto.",
      },
    },
  },
  paths: {
    "/": {
      get: {
        tags: ["Vehículos"],
        summary: "Estado de la API",
        responses: {
          200: {
            description: "API en ejecución.",
            content: {
              "application/json": {
                example: {
                  mensaje: "API REST de taller - TP N° 3 Programación Distribuida",
                  protocolo: "https",
                  recursos: ["/api/vehiculos", "/api/repuestos"],
                  docs: "/api-docs",
                  openapi: "/api-docs.json",
                },
              },
            },
          },
        },
      },
    },
    "/api/vehiculos": {
      get: {
        tags: ["Vehículos"],
        summary: "Listar vehículos",
        responses: {
          200: {
            description: "Listado persistido en MongoDB.",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Vehiculo" } },
              },
            },
          },
        },
      },
      post: {
        tags: ["Vehículos"],
        summary: "Crear vehículo",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/VehiculoInput" },
              examples: {
                valido: { value: { marca: "Honda", modelo: "Civic", anio: 2020, patente: "AE111BB", kilometraje: 30000 } },
                invalido: { value: { marca: "", modelo: "Civic", anio: 1800, patente: "??", kilometraje: -1 } },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Creado tras commit Raft y apply en State Machine.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Vehiculo" } } },
          },
          400: {
            description: "Datos inválidos.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          409: {
            description: "Patente duplicada.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          503: {
            description: "Nodo no es Leader, o no hay quorum.",
          },
        },
      },
    },
    "/api/raft/status": {
      get: {
        tags: ["Raft"],
        summary: "Estado observable del nodo",
        responses: {
          200: {
            description: "Identidad, rol, término, Leader, commit/applied.",
            content: {
              "application/json": {
                example: {
                  nodeId: "node1",
                  role: "LEADER",
                  currentTerm: 2,
                  leaderId: "node1",
                  commitIndex: 3,
                  lastApplied: 3,
                },
              },
            },
          },
        },
      },
    },
    "/api/raft/log": {
      get: {
        tags: ["Raft"],
        summary: "Vista del log Raft local",
        responses: {
          200: {
            description: "Entradas con flags committed/applied.",
          },
        },
      },
    },
    "/api/vehiculos/{id}": {
      get: {
        tags: ["Vehículos"],
        summary: "Consultar un vehículo",
        parameters: [{ $ref: "#/components/parameters/VehiculoId" }],
        responses: {
          200: {
            description: "Documento encontrado.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Vehiculo" } } },
          },
          400: { description: "Identificador inválido (no es un ObjectId)." },
          404: { description: "Identificador válido cuyo documento no existe." },
        },
      },
      put: {
        tags: ["Vehículos"],
        summary: "Reemplazar un vehículo",
        parameters: [{ $ref: "#/components/parameters/VehiculoId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/VehiculoInput" },
              example: { marca: "Toyota", modelo: "Corolla", anio: 2018, patente: "AB123CD", kilometraje: 98000 },
            },
          },
        },
        responses: {
          200: {
            description: "Actualizado.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Vehiculo" } } },
          },
          400: { description: "Datos o identificador inválidos." },
          404: { description: "No encontrado." },
          409: { description: "Patente duplicada." },
        },
      },
      delete: {
        tags: ["Vehículos"],
        summary: "Eliminar un vehículo",
        parameters: [{ $ref: "#/components/parameters/VehiculoId" }],
        responses: {
          204: { description: "Eliminado." },
          400: { description: "Identificador inválido." },
          404: { description: "No encontrado." },
        },
      },
    },
    "/api/repuestos": {
      get: {
        tags: ["Repuestos"],
        summary: "Listar stock",
        responses: {
          200: {
            description: "Listado persistido en MongoDB.",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Repuesto" } },
              },
            },
          },
        },
      },
    },
    "/api/repuestos/reiniciar": {
      post: {
        tags: ["Repuestos"],
        summary: "Restaurar la semilla de stock",
        responses: {
          200: {
            description: "Semilla restaurada (filtro=1, pastillas=4, bujías=8).",
          },
        },
      },
    },
    "/api/repuestos/{id}": {
      get: {
        tags: ["Repuestos"],
        summary: "Consultar un repuesto",
        parameters: [{ $ref: "#/components/parameters/RepuestoId" }],
        responses: {
          200: {
            description: "Documento encontrado.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Repuesto" } } },
          },
          400: { description: "Identificador inválido." },
          404: { description: "No encontrado." },
        },
      },
    },
    "/api/repuestos/{id}/lock": {
      get: {
        tags: ["Repuestos"],
        summary: "Inspeccionar el lock Redis del repuesto",
        parameters: [{ $ref: "#/components/parameters/RepuestoId" }],
        responses: {
          200: {
            description: "Estado de la clave lock:repuesto:{id}.",
            content: {
              "application/json": {
                example: {
                  clave: `lock:repuesto:${IDS.filtro}`,
                  existe: false,
                  propietario: null,
                  ttlMs: -2,
                },
              },
            },
          },
          400: { description: "Identificador inválido." },
          503: { description: "Redis/Memurai no disponible." },
        },
      },
    },
    "/api/repuestos/{id}/descontar": {
      post: {
        tags: ["Repuestos"],
        summary: "Descontar stock: lock Redis + commit Raft",
        parameters: [{ $ref: "#/components/parameters/RepuestoId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DescuentoInput" },
              example: { cantidad: 1 },
            },
          },
        },
        responses: {
          200: { description: "Stock descontado tras quorum Raft (y lock Redis)." },
          400: { description: "Identificador o cantidad inválidos." },
          404: { description: "Repuesto no encontrado." },
          409: { description: "Recurso ocupado o stock insuficiente." },
          503: { description: "No Leader / sin quorum / Redis caído." },
        },
      },
    },
    "/api/repuestos/{id}/descontar-sin-lock": {
      post: {
        tags: ["Repuestos"],
        summary: "Descontar stock SIN lock ni Raft (demo de carrera, solo Leader)",
        parameters: [{ $ref: "#/components/parameters/RepuestoId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DescuentoInput" },
              example: { cantidad: 1 },
            },
          },
        },
        responses: {
          200: { description: "Descontado. En concurrente puede dejar stock negativo." },
          400: { description: "Identificador o cantidad inválidos." },
          404: { description: "Repuesto no encontrado." },
          409: { description: "Stock insuficiente." },
        },
      },
    },
  },
};

function specPara(req) {
  const proto =
    req.secure || req.protocol === "https" || req.headers["x-forwarded-proto"] === "https"
      ? "https"
      : "http";
  const host = req.get("host");
  const copia = JSON.parse(JSON.stringify(spec));
  if (host) {
    copia.servers = [
      { url: `${proto}://${host}`, description: "Este servidor" },
      ...spec.servers,
    ];
  }
  return copia;
}

module.exports = {
  spec,
  specPara,
};
