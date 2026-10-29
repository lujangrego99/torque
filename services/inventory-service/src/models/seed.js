const Repuesto = require("./repuesto");
const logger = require("../config/logger");

// ObjectIds fijos (los mismos del monolito TP3): los usan las pruebas y
// workorders-service como referencias lógicas a repuestos.
const IDS = {
  filtro: "68c000000000000000000011",
  pastillas: "68c000000000000000000012",
  bujias: "68c000000000000000000013",
};

const SEMILLA_REPUESTOS = [
  { _id: IDS.filtro, nombre: "Filtro de aceite", codigo: "FIL-ACE-001", stock: 1 },
  { _id: IDS.pastillas, nombre: "Pastillas de freno delanteras", codigo: "PAS-FRE-001", stock: 4 },
  { _id: IDS.bujias, nombre: "Bujía NGK", codigo: "BUJ-NGK-001", stock: 8 },
];

async function seedSiVacio() {
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
  logger.warn("Stock de repuestos restaurado a la semilla.");
}

module.exports = { IDS, SEMILLA_REPUESTOS, seedSiVacio, reiniciarRepuestos };
