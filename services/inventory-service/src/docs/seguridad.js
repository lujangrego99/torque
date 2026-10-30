// Seguridad en el contrato OpenAPI (TP7): esquema Bearer, candado en cada
// endpoint protegido, rol requerido en el resumen y respuestas 401/403.
// La tabla ACCESO de openapi.js es la matriz de autorización del servicio.

const error = (descripcion, ejemplo) => ({
  description: descripcion,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: ejemplo } },
});

const r401 = error("Sin token, token mal formado, firma inválida o vencido", {
  error: "No autenticado.",
  detalles: ["El token venció."],
});

// acceso: { "GET /api/x": null | ["MECANICO", "ADMIN"] | ["ADMIN"] }   (null = público)
function aplicarSeguridad(spec, acceso) {
  spec.components = spec.components || {};
  spec.components.securitySchemes = {
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description: "Access token de POST /api/auth/login (auth-service).",
    },
  };
  for (const [clave, roles] of Object.entries(acceso)) {
    const [metodo, ruta] = clave.split(" ");
    const op = spec.paths[ruta] && spec.paths[ruta][metodo.toLowerCase()];
    if (!op) throw new Error(`OpenAPI: no existe ${clave}`);
    if (roles === null) {
      op.summary = `${op.summary} — público`;
      continue;
    }
    op.security = [{ bearerAuth: [] }];
    op.summary = `${op.summary} — ${roles.join(", ")}`;
    op.responses[401] = r401;
    if (roles.length < 2) {
      op.responses[403] = error(`Rol insuficiente (requiere ${roles.join(" o ")})`, {
        error: "Permisos insuficientes.",
        detalles: [`Esta operación requiere el rol ${roles.join(" o ")}.`],
      });
    }
  }
  return spec;
}

module.exports = { aplicarSeguridad, error };
