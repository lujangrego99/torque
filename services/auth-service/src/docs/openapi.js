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
    version: "2.0.0",
    description: [
      "Identidad y autenticación de torque. Dueño exclusivo de las colecciones `usuarios` y `sesiones`.",
      "",
      "1. `POST /api/auth/login` → copiar `accessToken` (y guardar `refreshToken`).",
      "2. Botón **Authorize** → pegar el access token (sin la palabra Bearer).",
      "3. Los endpoints con candado envían `Authorization: Bearer <token>`.",
      "4. Antes de que venza (5 min), `POST /api/auth/refresh` con el `refreshToken` → par nuevo (el anterior deja de servir).",
      "",
      "**Alta administrada:** no hay registro abierto. Los usuarios los crea un ADMIN con `POST /api/auth/usuarios`.",
      "",
      "Access token: JWT **HS256**, claims `sub` (id de usuario), `rol` (`MECANICO` | `ADMIN`), `sid` (sesión), `iss`, `aud`, `iat`, `exp`.",
      "Vence a los `JWT_EXPIRES_IN` (5 min). La sesión vence si no se renueva durante `SESSION_IDLE` (15 min).",
      "`POST /api/auth/logout` revoca la renovación; el access ya emitido sigue valiendo hasta su `exp`.",
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
    "/api/auth/login": {
      post: {
        tags: ["Autenticación"],
        summary: "Login (público) — emite access token (5 min) y refresh token",
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
    "/api/auth/refresh": {
      post: {
        tags: ["Autenticación"],
        summary: "Renovar la sesión (público, con el refresh token) — rota el refresh token",
        description:
          "Devuelve un access token nuevo y un refresh token nuevo; el anterior deja de servir. Si se presenta un refresh token ya usado, se revoca la sesión entera (posible robo).",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Refresh" } } } },
        responses: {
          200: { description: "Sesión renovada", content: { "application/json": { schema: { $ref: "#/components/schemas/Token" } } } },
          400: r400,
          401: error("Refresh token inválido, sesión cerrada, vencida por inactividad o token reutilizado", {
            error: "Sesión no válida.",
            detalles: ["La sesión venció por inactividad. Volver a iniciar sesión."],
          }),
          503: r503,
        },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: ["Autenticación"],
        summary: "Cerrar sesión (público, con el refresh token) — revoca la renovación",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Refresh" } } } },
        responses: { 204: { description: "Sesión cerrada (idempotente)" }, 400: r400, 503: r503 },
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
      post: {
        tags: ["Usuarios (ADMIN)"],
        summary: "Alta de usuario (alta administrada) — rol ADMIN",
        description: "Crea un MECANICO por defecto (`rol` opcional: MECANICO o ADMIN). La contraseña se guarda como hash bcrypt y no se devuelve.",
        security: conToken,
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AltaUsuario" } } } },
        responses: {
          201: { description: "Creado (sin contraseña ni hash)", content: { "application/json": { schema: { $ref: "#/components/schemas/Usuario" } } } },
          400: r400,
          401: r401,
          403: r403,
          409: error("Email ya registrado", { error: "Conflicto de integridad.", detalles: ["Ya existe un usuario con ese email."] }),
          503: r503,
        },
      },
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
      AltaUsuario: {
        type: "object",
        required: ["email", "nombre", "password"],
        properties: {
          email: { type: "string", format: "email", example: "mecanico@torque.local" },
          nombre: { type: "string", example: "Juan Pérez" },
          password: { type: "string", format: "password", minLength: 8, example: "clave-de-prueba-1" },
          rol: { type: "string", enum: ["MECANICO", "ADMIN"], default: "MECANICO" },
        },
      },
      Refresh: {
        type: "object",
        required: ["refreshToken"],
        properties: { refreshToken: { type: "string", example: "<refresh token opaco>" } },
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
          expiresIn: { type: "integer", description: "Segundos de vigencia del access token", example: 300 },
          refreshToken: { type: "string", description: "Opaco, de un solo uso: se rota en cada /refresh" },
          refreshExpiresIn: { type: "integer", description: "Segundos de inactividad tolerados", example: 900 },
          sesionVenceSinUsoEn: { type: "string", format: "date-time" },
          usuario: { $ref: "#/components/schemas/Usuario", description: "Solo en el login" },
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
