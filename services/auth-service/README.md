# auth-service

Identidad y autenticación de torque (servicio **nuevo** del TP7). Es la
**única autoridad** sobre usuarios y credenciales: dueño exclusivo de la
colección `usuarios` (base MongoDB `auth`). Emite los access tokens JWT que
validan los demás servicios. TP7 · torque · responsable: Gregorio Luján.

No tiene reglas del taller (vehículos, stock, órdenes): esas siguen en su
servicio dueño.

## Endpoints

| Método | Ruta | Acceso | Respuestas |
|---|---|---|---|
| POST | `/api/auth/register` | público | 201 (sin hash) · 400 · 409 email duplicado · 503 |
| POST | `/api/auth/login` | público | 200 `{accessToken, tokenType, expiresIn, usuario}` · 400 · 401 credenciales inválidas · 403 cuenta deshabilitada · 503 |
| GET | `/api/auth/me` | MECANICO, ADMIN | 200 · 401 |
| GET | `/api/auth/usuarios` | ADMIN | 200 · 401 · 403 |
| PATCH | `/api/auth/usuarios/:id` | ADMIN | 200 · 400 · 401 · 403 · 404 · 409 (un admin no puede quitarse el rol ni deshabilitarse) |
| GET | `/health` | público | 200 · 503 si Mongo no está |
| GET | `/api-docs` · `/api-docs.json` | público | Swagger UI · spec OpenAPI 3 (esquema `bearerAuth`) |

## Credenciales

- **bcrypt** (`bcryptjs`), costo `BCRYPT_ROUNDS` (12). El salt lo genera la librería y queda dentro del hash (`$2b$12$…`).
- La contraseña original no se guarda, no se loguea, no se devuelve y no va en el token. `passwordHash` tiene `select: false`: solo el login lo pide explícitamente.
- Contraseña: mínimo 8 caracteres y máximo 72 bytes (límite de bcrypt).
- **Login sin filtrar información:** usuario inexistente y contraseña incorrecta devuelven el mismo `401 Credenciales inválidas.` y tardan lo mismo (si el email no existe, se compara igual contra un hash ficticio). El log interno sí registra el motivo, con el email enmascarado.
- **Cuenta deshabilitada:** `403 Cuenta deshabilitada.`, solo si la contraseña es correcta.
- **Registro:** siempre crea `MECANICO`. Mandar `rol` responde 400: el rol no lo elige el cliente.
- **Admin inicial:** al arrancar, si no existe un usuario con `ADMIN_EMAIL`, se crea como `ADMIN` con `ADMIN_PASSWORD`.

## Token

```json
{ "sub": "6ae3dd9fb8829ebdfceb4f23", "rol": "MECANICO", "iss": "torque-auth", "aud": "torque", "iat": 1793318304, "exp": 1793319204 }
```

- **HS256** con `JWT_SECRET`. Vencimiento `JWT_EXPIRES_IN` (por defecto `15m`).
- Sin email, nombre, contraseña, hash ni secretos.
- Los servicios lo verifican con el mismo `JWT_SECRET`, `algorithms: ["HS256"]`, `issuer` y `audience`, sin consultar esta base.

## Estructura

```
src/
  index.js              arranque: puerto, Mongo con reintentos, índice único de email, admin inicial
  app.js                Express: request id, log por request (sin body ni headers), /health, Swagger, errores
  routes/auth.js        rutas públicas / autenticadas / ADMIN
  controllers/auth.js   adapta HTTP ↔ caso de uso
  services/usuarios.js  registro, login (bcrypt + emisión JWT), perfil, administración, admin inicial
  middleware/auth.js    validación del JWT (401) y autorización por rol (403)
  models/usuario.js     schema Mongoose (email único, passwordHash, rol, activo)
  config/               variables de entorno, logger (Winston a stdout), conexión Mongo
  docs/openapi.js       contrato OpenAPI
```

## Variables de entorno

| Variable | Local | Docker Compose | Descripción |
|---|---|---|---|
| `PORT` | `3004` | `3000` | puerto HTTP interno |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/auth` | `mongodb://auth-db:27017/auth` | base propia |
| `JWT_SECRET` | (≥ 32 caracteres) | `${JWT_SECRET}` del `.env` raíz | **obligatoria**: sin ella el servicio no arranca |
| `JWT_EXPIRES_IN` | `15m` | `${JWT_EXPIRES_IN:-15m}` | vigencia del access token |
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
