const Vehiculo = require("./vehiculo");
const logger = require("../config/logger");

// ObjectIds fijos (los mismos del monolito TP3) para que las pruebas,
// Swagger y workorders-service tengan ejemplos estables.
const IDS = {
  corolla: "68c000000000000000000001",
  ranger: "68c000000000000000000002",
  gol: "68c000000000000000000003",
};

const SEMILLA_VEHICULOS = [
  { _id: IDS.corolla, marca: "Toyota", modelo: "Corolla", anio: 2018, patente: "AB123CD", kilometraje: 95000, duenio: { nombre: "Laura Gómez", telefono: "261 555-0101" } },
  { _id: IDS.ranger, marca: "Ford", modelo: "Ranger", anio: 2021, patente: "AC456EF", kilometraje: 42000, duenio: { nombre: "Martín Sosa", telefono: "261 555-0102" } },
  { _id: IDS.gol, marca: "Volkswagen", modelo: "Gol", anio: 2015, patente: "AD789GH", kilometraje: 130000, duenio: { nombre: "Carla Ruiz", telefono: "261 555-0103" } },
];

// Solo si la colección está vacía: si se reinsertara en cada arranque,
// la prueba de persistencia no demostraría nada.
async function seedSiVacio() {
  if ((await Vehiculo.countDocuments()) === 0) {
    await Vehiculo.insertMany(SEMILLA_VEHICULOS);
    logger.info(`Seed de vehículos insertado (${SEMILLA_VEHICULOS.length} documentos).`);
  } else {
    logger.info("Seed de vehículos omitido: la colección ya tiene documentos.");
  }
}

module.exports = { IDS, SEMILLA_VEHICULOS, seedSiVacio };
