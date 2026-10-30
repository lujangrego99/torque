// Contrato OpenAPI 3 de auth-service: única autoridad sobre usuarios y
// credenciales. Emite los access tokens que validan los demás servicios.
const error = (descripcion, ejemplo) => ({
  description: descripcion,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: ejemplo } },
});

const r400 = error("Datos inválidos", { error: "Datos inválidos o incompletos.", detalles: ["email es obligatorio y debe tener formato válido."] });
const r401 = error("Sin token, token mal formado, firma inválida o vencido", { error: "No autenticado.", detalles: ["El token venció."] });
const r403 = error("Rol insuficiente (requiere ADMIN)", { error: "Permisos insuficientes.", detalles: ["Esta operación requiere el rol ADMIN."] });
const r503 = error("MongoDB no disponible", { error: "Servicio no disponible.", detalles: ["La base de datos de auth-service no está disponible."] });
const conToken = [{ bearerAuth: [] }];

module.exports = {
  openapi: "3.0.3",
  info: {
    title: "auth-service",
    version: "1.0.0",
    description: [
      "Identidad y autenticación de torque (TP7). Dueño exclusivo de la colección `usuarios`.",
      "",
      "1. `POST /api/auth/login` → copiar `accessToken`.",
      "2. Botón **Authorize** → pegar el token (sin la palabra Bearer).",
      "3. Los endpoints con candado envían `Authorization: Bearer <token>`.",
      "",
      "Token: JWT **HS256**, claims `sub` (id de usuario), `rol` (`MECANICO` | `ADMIN`), `iss`, `aud`, `iat`, `exp`.",
      "Vencimiento configurable con `JWT_EXPIRES_IN` (por defecto 15 minutos).",
    ].join("\n"),
  },
  servers: [{ url: "/" }],
  tags: [{ name: "Autenticación" }, { name: "Usuarios (ADMIN)" }, { name: "Salud" }],
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
    "/api/auth/register": {
      post: {
        tags: ["Autenticación"],
        summary: "Registro de usuario (público) — siempre crea un MECANICO",
        description: "El rol no se puede elegir: enviar `rol` o `roles` responde 400. La contraseña se guarda como hash bcrypt.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Registro" } } },
        },
        responses: {
          201: { description: "Creado (sin contraseña ni hash)", content: { "application/json": { schema: { $ref: "#/components/schemas/Usuario" } } } },
          400: r400,
          409: error("Email ya registrado", { error: "Conflicto de integridad.", detalles: ["Ya existe un usuario con ese email."] }),
          503: r503,
        },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Autenticación"],
        summary: "Login (público) — emite el access token",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Login" } } },
        },
        responses: {
          200: { description: "Credenciales válidas", content: { "application/json": { schema: { $ref: "#/components/schemas/Token" } } } },
          400: r400,
          401: error("Usuario inexistente o contraseña incorrecta (no se distingue cuál)", { error: "Credenciales inválidas." }),
          403: error("Cuenta deshabilitada (solo con contraseña correcta)", { error: "Cuenta deshabilitada.", detalles: ["Pedile a un administrador que la reactive."] }),
          503: r503,
        },
      },
    },
    "/api/auth/me": {
      get: {
        tags: ["Autenticación"],
        summary: "Perfil del usuario del token (MECANICO, ADMIN)",
        security: conToken,
        responses: {
          200: { description: "Usuario", content: { "application/json": { schema: { $ref: "#/components/schemas/Usuario" } } } },
          401: r401,
          404: error("El usuario del token ya no existe", { error: "Usuario no encontrado." }),
          503: r503,
        },
      },
    },
    "/api/auth/usuarios": {
      get: {
        tags: ["Usuarios (ADMIN)"],
        summary: "Listar usuarios — rol ADMIN",
        security: conToken,
        responses: {
          200: { description: "Listado", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Usuario" } } } } },
          401: r401,
          403: r403,
          503: r503,
        },
      },
    },
    "/api/auth/usuarios/{id}": {
      patch: {
        tags: ["Usuarios (ADMIN)"],
        summary: "Cambiar rol o habilitar/deshabilitar — rol ADMIN",
        security: conToken,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CambioUsuario" } } },
        },
        responses: {
          200: { description: "Actualizado", content: { "application/json": { schema: { $ref: "#/components/schemas/Usuario" } } } },
          400: r400,
          401: r401,
          403: r403,
          404: error("Usuario inexistente", { error: "Usuario no encontrado." }),
          409: error("Un admin no puede quitarse el rol ni deshabilitarse", { error: "Operación no permitida." }),
          503: r503,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Access token de POST /api/auth/login." },
    },
    schemas: {
      Registro: {
        type: "object",
        required: ["email", "nombre", "password"],
        properties: {
          email: { type: "string", format: "email", example: "mecanico@torque.local" },
          nombre: { type: "string", example: "Juan Pérez" },
          password: { type: "string", format: "password", minLength: 8, example: "clave-de-prueba-1" },
        },
      },
      Login: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", example: "mecanico@torque.local" },
          password: { type: "string", format: "password", example: "clave-de-prueba-1" },
        },
      },
      Token: {
        type: "object",
        properties: {
          accessToken: { type: "string", example: "<jwt>" },
          tokenType: { type: "string", example: "Bearer" },
          expiresIn: { type: "integer", description: "Segundos de vigencia", example: 900 },
          usuario: { $ref: "#/components/schemas/Usuario" },
        },
      },
      CambioUsuario: {
        type: "object",
        properties: {
          rol: { type: "string", enum: ["MECANICO", "ADMIN"] },
          activo: { type: "boolean" },
        },
      },
      Usuario: {
        type: "object",
        properties: {
          id: { type: "string", example: "6720f0c2a1b2c3d4e5f60718" },
          email: { type: "string", example: "mecanico@torque.local" },
          nombre: { type: "string", example: "Juan Pérez" },
          rol: { type: "string", enum: ["MECANICO", "ADMIN"] },
          activo: { type: "boolean" },
          creadoEn: { type: "string", format: "date-time" },
        },
      },
      Health: {
        type: "object",
        properties: {
          service: { type: "string", example: "auth-service" },
          status: { type: "string", enum: ["ok", "degraded"] },
          dependencias: { type: "object", properties: { mongo: { type: "string", enum: ["up", "down"] } } },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          detalles: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};
