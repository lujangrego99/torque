// Error de negocio con status HTTP. La capa de servicios lo lanza y el
// middleware de app.js lo traduce a respuesta.
class ErrorHttp extends Error {
  constructor(status, error, detalles) {
    super(error);
    this.status = status;
    this.error = error;
    this.detalles = detalles;
  }
}

function invalido(detalles) {
  return new ErrorHttp(400, "Datos inválidos o incompletos.", detalles);
}

// Errores de infraestructura de Mongo: la base no está disponible.
function esBaseNoDisponible(err) {
  return /Mongo(Network|ServerSelection|NotConnected)Error|MongooseServerSelectionError/.test(err.name) ||
    /before initial connection is complete|Client must be connected/.test(err.message || "");
}

module.exports = { ErrorHttp, invalido, esBaseNoDisponible };
