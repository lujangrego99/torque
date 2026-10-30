# TP7 — Autenticación y autorización con JWT

| Documento | Contenido | Autor |
|---|---|---|
| [01-plan-implementacion.md](01-plan-implementacion.md) | Hito 1: identidad del dominio, responsable (auth-service), modelo de usuario, matriz de endpoints y de autorización, reparto | Gregorio Luján |
| [errores-401-403.md](errores-401-403.md) | 401 vs 403, flujo del middleware, tabla de errores de seguridad | Manuel Moya |
| [secretos-y-configuracion.md](secretos-y-configuracion.md) | Variables, cómo se comparte el secreto, qué no se versiona, logs sin secretos | Jan Lahorca |
| [propagacion-y-propiedad.md](propagacion-y-propiedad.md) | Propagación del token entre servicios, propiedad de las órdenes, auth-service caído | Agustín Martínez |
| [../../services/auth-service/README.md](../../services/auth-service/README.md) | auth-service: endpoints, bcrypt, claims, variables | Gregorio Luján |
| [../../README.md](../../README.md) | Cómo levantar, registrar, loguearse y usar el token; pruebas | Grupo |

## Resumen del modelo (§12)

| Pregunta | Respuesta |
|---|---|
| ¿Quién emite los tokens? | `auth-service`, único dueño de usuarios y credenciales |
| ¿Quién valida? | `vehicles-service`, `inventory-service`, `workorders-service` y `auth-service` (`/me`, `/usuarios`), cada uno con su `src/middleware/auth.js`. El gateway no valida: reenvía `Authorization` |
| ¿Qué usa cada servicio del token? | `sub` y `rol`. vehicles e inventory: el `rol` (RBAC). workorders: `rol` + `sub` (propiedad de la orden, `creadaPor`). auth-service: `sub` (`/me`) y `rol` (`/usuarios`) |
| ¿Cómo se comparte la configuración de firma? | `JWT_SECRET` (HS256) del `.env` raíz, que Compose pasa por entorno a los 4 servicios (ancla `x-jwt-env`). Nunca en código ni imágenes |
| ¿Qué pasa si auth-service cae con un token ya emitido? | El token sigue valiendo hasta su `exp` (verificación local). Solo fallan login y registro (503) |

## Evidencias (`evidencias/`)

Las genera `bash scripts/pruebas-tp7.sh`. Cada archivo muestra el **comando** y
su **salida real**. Los tokens se muestran truncados (`eyJhbGciOiJIUzI1…(oculto)`)
junto con su payload decodificado. La contraseña del admin nunca se imprime.

| Archivo | Escenario (§19) | Qué demuestra |
|---|---|---|
| `00-arranque.txt` | — | `.env` ignorado por git; `up --build --wait` con 10 contenedores `healthy` |
| `A-registro.txt` | **A** | registro → 201 como MECANICO, sin contraseña ni hash en la respuesta; datos inválidos → 400 |
| `B-duplicado.txt` | **B** | email duplicado (también con mayúsculas) → 409; intentar elegir `rol` → 400 |
| `C-login-valido.txt` | **C** | login → 200 + JWT; header `HS256` y claims `sub, rol, iss, aud, iat, exp` (vigencia 900 s) |
| `D-login-invalido.txt` | **D** | contraseña incorrecta y usuario inexistente → el mismo 401; entrada inválida → 400; log con motivo y email enmascarado |
| `E-sin-token.txt` | **E** | sin token → 401 + `WWW-Authenticate`; header sin Bearer y token basura → 401; catálogo público → 200 |
| `F-token-modificado.txt` | **F** | payload editado (rol → ADMIN) → 401 firma inválida; `alg: none` → 401; firmado con otra clave → 401 |
| `G-token-vencido.txt` | **G** | `JWT_EXPIRES_IN=5s`: 200 antes, 401 "El token venció." después |
| `H-rol-insuficiente.txt` | **H** | MECANICO en DELETE vehículo / reiniciar stock / usuarios → 403; orden ajena → 403; listado sin órdenes ajenas |
| `I-rol-autorizado.txt` | **I** | MECANICO crea vehículo (201); ADMIN lo borra (204), reinicia stock y lista usuarios (200); dueño y ADMIN ven la orden |
| `J-propagacion.txt` | **J** | orden gateway → workorders → vehicles + inventory con el mismo token y `rid`; `creadaPor = sub`; descuento sin token dentro de la red → 401 |
| `K-reinicio.txt` | **K** | `down` (sin `-v`) + `up`: contenedores nuevos, el usuario sigue y vuelve a loguearse |
| `L-hash-persistido.txt` | **L** | `passwordHash` = `$2b$12$…` en `auth-db`; la contraseña en texto plano no aparece; las otras bases no tienen usuarios |
| `M-auth-no-disponible.txt` | §12 | auth-service detenido: el token emitido sigue funcionando; login → 503; al volver, login OK |
| `N-swagger.txt` | §16 | `bearerAuth` y, por operación: público/bearer, 401/403 y rol requerido |
| `O-secretos.txt` | §15, §17 | solo `.env.example` versionados; `JWT_SECRET` no está en el historial; 0 tokens y 0 contraseñas en los logs |
