# auth-service

Identidad y autenticación de torque (servicio **nuevo** del TP7). Es la
**única autoridad** sobre usuarios y credenciales: dueño exclusivo de la
colecciones `usuarios` y `sesiones` (base MongoDB `auth`). Emite los access
tokens JWT que validan los demás servicios. TP7 y correcciones de la 1ª revisión
(alta administrada, sesión renovable) · torque · responsable: Gregorio Luján.

No tiene reglas del taller (vehículos, stock, órdenes): esas siguen en su
servicio dueño.

## Endpoints

| Método | Ruta | Acceso | Respuestas |
|---|---|---|---|
| POST | `/api/auth/login` | público | 200 `{accessToken, tokenType, expiresIn, refreshToken, refreshExpiresIn, sesionVenceSinUsoEn, usuario}` · 400 · 401 credenciales inválidas · 403 cuenta deshabilitada · 503 |
| POST | `/api/auth/refresh` | público (con el refresh token) | 200 par nuevo (rota el refresh) · 400 · 401 sesión cerrada / vencida por inactividad / refresh reutilizado |
| POST | `/api/auth/logout` | público (con el refresh token) | 204 (idempotente) · 400 |
| GET | `/api/auth/me` | MECANICO, ADMIN | 200 · 401 |
| POST | `/api/auth/usuarios` | ADMIN | 201 alta administrada (sin hash; `rol` opcional, MECANICO por defecto) · 400 · 401 · 403 · 409 email duplicado |
| GET | `/api/auth/usuarios` | ADMIN | 200 · 401 · 403 |
| PATCH | `/api/auth/usuarios/:id` | ADMIN | 200 · 400 · 401 · 403 · 404 · 409 (un admin no puede quitarse el rol ni deshabilitarse). Deshabilitar revoca sus sesiones |
| GET | `/metrics` | público (interno) | métricas del proceso (JSON, o `?formato=prometheus`) |

`POST /api/auth/register` **ya no existe** (404): el alta es administrada.
| GET | `/health` | público | 200 · 503 si Mongo no está |
| GET | `/api-docs` · `/api-docs.json` | público | Swagger UI · spec OpenAPI 3 (esquema `bearerAuth`) |

## Credenciales

- **bcrypt** (`bcryptjs`), costo `BCRYPT_ROUNDS` (12). El salt lo genera la librería y queda dentro del hash (`$2b$12$…`).
- La contraseña original no se guarda, no se loguea, no se devuelve y no va en el token. `passwordHash` tiene `select: false`: solo el login lo pide explícitamente.
- Contraseña: mínimo 8 caracteres y máximo 72 bytes (límite de bcrypt).
- **Login sin filtrar información:** usuario inexistente y contraseña incorrecta devuelven el mismo `401 Credenciales inválidas.` y tardan lo mismo (si el email no existe, se compara igual contra un hash ficticio). El log interno sí registra el motivo, con el email enmascarado.
- **Cuenta deshabilitada:** `403 Cuenta deshabilitada.`, solo si la contraseña es correcta.
- **Alta administrada:** solo un ADMIN da de alta usuarios (MECANICO por defecto). No hay registro abierto.
- **Admin inicial:** al arrancar, si no existe un usuario con `ADMIN_EMAIL`, se crea como `ADMIN` con `ADMIN_PASSWORD`.

## Token

```json
{ "sub": "6ae3dd9fb8829ebdfceb4f23", "rol": "MECANICO", "sid": "6af0ca7ca3c2852c8fbc291f", "iss": "torque-auth", "aud": "torque", "iat": 1793318304, "exp": 1793318604 }
```

- **HS256** con `JWT_SECRET`. Vencimiento `JWT_EXPIRES_IN` (por defecto `5m`). `sid` = sesión que lo emitió.
- Sin email, nombre, contraseña, hash ni secretos.
- Los servicios lo verifican con el mismo `JWT_SECRET`, `algorithms: ["HS256"]`, `issuer` y `audience`, sin consultar esta base.

## Sesión renovable

- El login abre una **sesión** (`sesiones`) y devuelve un **refresh token** opaco (aleatorio, 32 bytes). En la base se guarda solo su hash SHA-256.
- `POST /refresh` entrega un access token nuevo y **rota** el refresh token (el anterior deja de servir). Cada renovación corre el plazo de inactividad.
- Sin renovar durante `SESSION_IDLE` (15 min) la sesión vence. Un refresh ya rotado que se vuelve a presentar revoca la sesión entera (posible robo).
- `POST /logout` y deshabilitar al usuario revocan la renovación. El access token ya emitido vale hasta su `exp` (≤ 5 min), porque los servicios no consultan a auth.
- Mongo borra las sesiones vencidas un día después (índice TTL).

## Estructura

```
src/
  index.js              arranque: puerto, Mongo con reintentos, índice único de email, admin inicial
  app.js                Express: request id, log por request (sin body ni headers), /health, Swagger, errores
  routes/auth.js        rutas públicas / autenticadas / ADMIN
  controllers/auth.js   adapta HTTP ↔ caso de uso
  services/usuarios.js  alta administrada, login (bcrypt + emisión JWT), renovación, logout, perfil, administración, admin inicial
  services/sesiones.js  refresh tokens: apertura, rotación, inactividad, revocación
  middleware/auth.js    validación del JWT (401) y autorización por rol (403)
  models/usuario.js     schema Mongoose (email único, passwordHash, rol, activo)
  models/sesion.js      sesiones renovables (hash del refresh token, último uso, vencimiento, revocación)
  config/               variables de entorno, logger (Winston a stdout), conexión Mongo
  docs/openapi.js       contrato OpenAPI
```

## Variables de entorno

| Variable | Local | Docker Compose | Descripción |
|---|---|---|---|
| `PORT` | `3004` | `3000` | puerto HTTP interno |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/auth` | `mongodb://auth-db:27017/auth` | base propia |
| `JWT_SECRET` | (≥ 32 caracteres) | `${JWT_SECRET}` del `.env` raíz | **obligatoria**: sin ella el servicio no arranca |
| `JWT_EXPIRES_IN` | `5m` | `${JWT_EXPIRES_IN:-5m}` | vigencia del access token |
| `SESSION_IDLE` | `15m` | `${SESSION_IDLE:-15m}` | inactividad máxima de una sesión (`30s`, `15m`, `1h`) |
| `JWT_ISSUER` · `JWT_AUDIENCE` | `torque-auth` · `torque` | ídem | claims `iss` / `aud` |
| `BCRYPT_ROUNDS` | `12` | `${BCRYPT_ROUNDS:-12}` | costo de bcrypt |
| `ADMIN_EMAIL` · `ADMIN_PASSWORD` · `ADMIN_NOMBRE` | — | del `.env` raíz | admin inicial |
| `LOG_LEVEL` | `info` | `info` | nivel de Winston |

Ver `.env.example`. El `.env` real no se versiona.

## Ejecutar con Node (sin Docker)

```bash
cd services/auth-service
cp .env.example .env      # completar JWT_SECRET (openssl rand -base64 48) y ADMIN_PASSWORD
npm install
npm start                 # http://localhost:3004/api-docs
```

## Docker (imagen individual)

```bash
docker build -t torque/auth-service:tp7 ./services/auth-service
docker run --rm -p 3004:3000 -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e MONGODB_URI=mongodb://host.docker.internal:27017/auth torque/auth-service:tp7
```
