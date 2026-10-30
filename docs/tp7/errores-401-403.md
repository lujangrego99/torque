# TP7 · 401 vs 403 y manejo de errores de seguridad

**Autor:** Manuel Moya (`vehicles-service`)

Autenticación y autorización son dos preguntas distintas y tienen dos códigos
distintos:

| Código | Pregunta que falla | Cuándo en torque |
|---|---|---|
| **401 Unauthorized** | ¿Quién sos? (no hay identidad válida) | sin header, header sin `Bearer`, token que no es JWT, firma inválida, `alg` distinto de HS256 (incluido `none`), otro emisor/audiencia, token vencido, credenciales de login inválidas |
| **403 Forbidden** | ¿Podés hacer esto? (la identidad es válida) | MECANICO en una operación de ADMIN, MECANICO pidiendo una orden ajena, login con cuenta deshabilitada |

## Flujo del middleware (`src/middleware/auth.js`)

```
Request
  |
  +-- sin Authorization ---------------> 401  "Falta el header Authorization: Bearer <token>."
  +-- no es "Bearer <token>" ----------> 401  "El header Authorization debe tener el formato…"
  +-- jwt.verify(HS256, iss, aud):
  |     mal formado ------------------> 401  "El token está mal formado."
  |     firma inválida ---------------> 401  "La firma del token no es válida."
  |     vencido (exp) ----------------> 401  "El token venció."
  |     otro alg / iss / aud ---------> 401  "El token no es válido."
  |     sin sub o rol desconocido ----> 401  "El token no tiene una identidad válida."
  |
  +-- válido -> req.usuario = { id: sub, rol } -> next()
                    |
                    autorizar("ADMIN") -- rol no incluido --> 403 "Esta operación requiere el rol ADMIN."
```

- Todas las respuestas 401 llevan `WWW-Authenticate: Bearer realm="torque", error="invalid_token"` (o `invalid_request` si falta o está mal el header).
- El cuerpo es siempre `{ "error": "...", "detalles": [...] }`, igual que el resto de errores del servicio (TP6).
- La verificación es **local**: no se consulta auth-service ni ninguna base. Se usa `algorithms: ["HS256"]` explícito; así un token `alg: none` o firmado con otro algoritmo no se acepta nunca.

## Aplicación en vehicles-service

`src/routes/vehiculos.js`:

```js
router.use(autenticar);                                   // todo el recurso: 401 sin identidad
router.get("/", …); router.post("/", …); router.put("/:id", …);   // MECANICO y ADMIN
router.delete("/:id", autorizar("ADMIN"), …);              // 403 para MECANICO
```

La lógica de verificación no está repetida en cada controlador: un único
middleware reutilizable y una línea por ruta.

## Tabla de errores de seguridad (§18)

| Situación | Código | Cuerpo |
|---|---|---|
| Payload inválido (registro/login) | 400 | `Datos inválidos o incompletos.` + detalles |
| Credenciales inválidas | 401 | `Credenciales inválidas.` (mismo mensaje si el usuario no existe o la contraseña es incorrecta) |
| Token ausente, inválido o vencido | 401 | `No autenticado.` + motivo |
| Permisos insuficientes | 403 | `Permisos insuficientes.` + rol requerido |
| Cuenta deshabilitada (contraseña correcta) | 403 | `Cuenta deshabilitada.` |
| Usuario ya existente | 409 | `Conflicto de integridad.` |
| Error interno | 500 | `Error interno del servidor.` (sin stack trace ni detalles de librerías) |

## Logs

- 401: `WARN … GET /api/vehiculos: 401 invalid_token (El token venció.) rid=…` — se registra el motivo, **nunca** el token.
- 403: `WARN … DELETE /api/vehiculos/…: 403 sub=<id> rol=MECANICO (requiere ADMIN) rid=…`.

Evidencias: `docs/tp7/evidencias/E-sin-token.txt`, `F-token-modificado.txt`,
`G-token-vencido.txt`, `H-rol-insuficiente.txt`.
