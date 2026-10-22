const Vehiculo = require("./models/vehiculo");
const Repuesto = require("./models/repuesto");
const logger = require("./logger");
const IDS = require("./ids");
const { serializarVehiculo, serializarRepuesto } = require("./utils/serializar");

const SEMILLA_VEHICULOS = [
  {
    _id: IDS.corolla,
    marca: "Toyota",
    modelo: "Corolla",
    anio: 2018,
    patente: "AB123CD",
    kilometraje: 95000,
  },
  {
    _id: IDS.ranger,
    marca: "Ford",
    modelo: "Ranger",
    anio: 2021,
    patente: "AC456EF",
    kilometraje: 42000,
  },
  {
    _id: IDS.gol,
    marca: "Volkswagen",
    modelo: "Gol",
    anio: 2015,
    patente: "AD789GH",
    kilometraje: 130000,
  },
];

const SEMILLA_REPUESTOS = [
  {
    _id: IDS.filtro,
    nombre: "Filtro de aceite",
    codigo: "FIL-ACE-001",
    stock: 1,
  },
  {
    _id: IDS.pastillas,
    nombre: "Pastillas de freno delanteras",
    codigo: "PAS-FRE-001",
    stock: 4,
  },
  {
    _id: IDS.bujias,
    nombre: "Bujía NGK",
    codigo: "BUJ-NGK-001",
    stock: 8,
  },
];

async function seedSiVacio() {
  if ((await Vehiculo.countDocuments()) === 0) {
    await Vehiculo.insertMany(SEMILLA_VEHICULOS);
    logger.info(`Seed de vehículos insertado (${SEMILLA_VEHICULOS.length} documentos).`);
  } else {
    logger.info("Seed de vehículos omitido: la colección ya tiene documentos.");
  }

  if ((await Repuesto.countDocuments()) === 0) {
    await Repuesto.insertMany(SEMILLA_REPUESTOS);
    logger.info(`Seed de repuestos insertado (${SEMILLA_REPUESTOS.length} documentos).`);
  } else {
    logger.info("Seed de repuestos omitido: la colección ya tiene documentos.");
  }
}

async function reiniciarRepuestos() {
  await Repuesto.deleteMany({});
  await Repuesto.insertMany(SEMILLA_REPUESTOS);
  const docs = await Repuesto.find().sort({ codigo: 1 });
  logger.warn("Stock de repuestos restaurado a la semilla.");
  return docs.map(serializarRepuesto);
}

async function listarSemillaVehiculos() {
  return SEMILLA_VEHICULOS.map((item) => serializarVehiculo(item));
}

module.exports = {
  IDS,
  SEMILLA_VEHICULOS,
  SEMILLA_REPUESTOS,
  seedSiVacio,
  reiniciarRepuestos,
  listarSemillaVehiculos,
};
