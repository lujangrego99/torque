function detallesValidacion(err) {
  return Object.values(err.errors || {}).map((item) => item.message);
}

function conflictoUnicidad(err) {
  const campo = Object.keys(err.keyPattern || err.keyValue || {})[0] || "campo único";
  if (campo === "patente") {
    return "Ya existe un vehículo con esa patente.";
  }
  if (campo === "codigo") {
    return "Ya existe un repuesto con ese código.";
  }
  return `Ya existe un documento con ese valor de ${campo}.`;
}

function interpretarErrorPersistencia(err) {
  if (!err) {
    return null;
  }

  if (err.name === "ValidationError") {
    return {
      status: 400,
      error: "Datos inválidos o incompletos.",
      detalles: detallesValidacion(err),
    };
  }

  if (err.name === "CastError") {
    return {
      status: 400,
      error: "Datos inválidos o incompletos.",
      detalles: ["Identificador o tipo de dato inválido."],
    };
  }

  if (err.code === 11000) {
    return {
      status: 409,
      error: "Conflicto de integridad.",
      detalles: [conflictoUnicidad(err)],
    };
  }

  return null;
}

module.exports = {
  interpretarErrorPersistencia,
};
