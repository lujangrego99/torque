// Error de negocio con status HTTP. La capa de servicios lo lanza y el
// controlador / middleware lo traduce a respuesta.
class ErrorHttp extends Error {
  // `extra`: campos adicionales para el cuerpo de la respuesta (p. ej. el
  // vehículo existente cuando la patente ya está cargada).
  constructor(status, error, detalles, extra) {
    super(error);
    this.status = status;
    this.error = error;
    this.detalles = detalles;
    this.extra = extra;
  }
}

function invalido(detalles) {
  return new ErrorHttp(400, "Datos inválidos o incompletos.", detalles);
}

function detallesValidacion(err) {
  return Object.values(err.errors || {}).map((item) => item.message);
}

// Traduce errores de Mongoose a errores funcionales (400 / 409).
function interpretarErrorPersistencia(err) {
  if (err.name === "ValidationError") {
    return invalido(detallesValidacion(err));
  }
  if (err.name === "CastError") {
    return invalido(["Identificador o tipo de dato inválido."]);
  }
  if (err.code === 11000) {
    return new ErrorHttp(409, "Conflicto de integridad.", ["Ya existe un vehículo con esa patente."]);
  }
  return null;
}

// Errores de infraestructura de Mongo: la base no está disponible.
function esBaseNoDisponible(err) {
  return /Mongo(Network|ServerSelection|NotConnected)Error|MongooseServerSelectionError/.test(err.name) ||
    /before initial connection is complete|Client must be connected/.test(err.message || "");
}

module.exports = { ErrorHttp, invalido, interpretarErrorPersistencia, esBaseNoDisponible };
