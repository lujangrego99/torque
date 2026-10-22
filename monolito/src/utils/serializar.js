function serializarVehiculo(doc) {
  return {
    id: String(doc._id),
    marca: doc.marca,
    modelo: doc.modelo,
    anio: doc.anio,
    patente: doc.patente,
    kilometraje: doc.kilometraje,
  };
}

function serializarRepuesto(doc) {
  return {
    id: String(doc._id),
    nombre: doc.nombre,
    codigo: doc.codigo,
    stock: doc.stock,
  };
}

module.exports = {
  serializarVehiculo,
  serializarRepuesto,
};
