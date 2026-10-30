# TP7 · Secretos y configuración

**Autor:** Jan Lahorca (`inventory-service`)

## Variables de seguridad

| Variable | Dónde se usa | Obligatoria | Valor por defecto |
|---|---|---|---|
| `JWT_SECRET` | auth-service (firma) · vehicles, inventory, workorders (verificación) | **Sí** (≥ 32 caracteres) | ninguno: sin ella el servicio no arranca |
| `JWT_EXPIRES_IN` | auth-service | No | `15m` |
| `JWT_ISSUER` / `JWT_AUDIENCE` | todos los que firman/validan | No | `torque-auth` / `torque` |
| `BCRYPT_ROUNDS` | auth-service | No | `12` |
| `ADMIN_EMAIL` / `ADMIN_NOMBRE` | auth-service (admin inicial) | No | `admin@torque.local` / `Administrador` |
| `ADMIN_PASSWORD` | auth-service (admin inicial) | **Sí** en Compose | ninguno |

## Cómo se comparte el secreto

- `.env` en la raíz (no versionado) → `docker-compose.yml` lo lee con `${JWT_SECRET:?…}`: si falta, **Compose no arranca** y muestra el mensaje.
- El ancla `x-jwt-env` pasa el mismo `JWT_SECRET`, `JWT_ISSUER` y `JWT_AUDIENCE` a los cuatro servicios que firman o validan. El gateway **no** lo recibe (no valida tokens).
- `scripts/generar-env.sh` crea `.env` desde `.env.example` con `JWT_SECRET` (48 bytes aleatorios) y `ADMIN_PASSWORD` aleatoria, con permisos `600`. No pisa un `.env` existente.
- Cada `config/index.js` corta el arranque si `JWT_SECRET` falta o tiene menos de 32 caracteres. Nunca hay un secreto "por defecto" en el código.

## Qué NO se versiona (revisado)

| Qué | Cómo se evita |
|---|---|
| `.env` reales | `.gitignore` (`.env`, `.env.local`, `.env.*.local`) y `.dockerignore` en cada servicio (no entran en la imagen) |
| `JWT_SECRET`, contraseñas | solo en `.env`; los `.env.example` tienen las variables **vacías** |
| Claves y certificados | `.gitignore`: `*.key`, `*.pem`, `*.pfx`, `**/certs/*` |
| Tokens reales | las evidencias muestran solo los primeros 16 caracteres (`eyJhbGciOiJIUzI1…(oculto)`) y el payload decodificado |
| `node_modules` | `.gitignore` y `.dockerignore` |

Revisión del historial (evidencia `O-secretos.txt`):

```bash
git ls-files | grep -E '(^|/)\.env|\.key$|\.pem$|\.crt$'   # → solo *.env.example
git log --all -p | grep -c "$JWT_SECRET"                    # → 0
```

No se encontró ningún secreto versionado, así que no hubo que rotar nada. Si
pasara: generar un `JWT_SECRET` nuevo (todos los tokens anteriores dejan de
validar), cambiar las contraseñas expuestas y documentarlo acá.

## Logs sin secretos

- Login: `Login fallido email=me***@torque.local motivo=password_incorrecta` (email enmascarado, nunca la contraseña).
- 401: se loguea el motivo (`El token venció.`), nunca el token.
- El request log (`método ruta status duración rid`) no incluye headers ni body.
- Evidencia: `grep` de tokens (`eyJ…`), de la contraseña de prueba y de `ADMIN_PASSWORD` en `docker compose logs` → 0.

## Aplicación en inventory-service

| Endpoint | Acceso |
|---|---|
| `GET /api/repuestos` · `GET /api/repuestos/:id` | público (catálogo) |
| `POST /api/repuestos/:id/descontar` | MECANICO, ADMIN |
| `POST /api/repuestos/reiniciar` · `GET /:id/lock` · `POST /:id/descontar-sin-lock` | ADMIN |

El descuento se pide con el token del usuario que creó la orden (lo propaga
workorders-service): inventory sabe **quién** consume stock sin conocer la base
de usuarios.
