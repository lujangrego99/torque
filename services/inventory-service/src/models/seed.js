const Repuesto = require("./repuesto");
const Movimiento = require("./movimiento");
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

// El stock inicial también es un movimiento (INGRESO del "sistema"): así la
// suma del libro coincide con el stock desde el primer momento.
function movimientosIniciales() {
  return SEMILLA_REPUESTOS.map((r) => ({
    repuestoId: String(r._id),
    codigo: r.codigo,
    tipo: "INGRESO",
    cantidad: r.stock,
    stockAnterior: 0,
    stockResultante: r.stock,
    usuario: "sistema",
    motivo: "Stock inicial (semilla)",
  }));
}

async function seedSiVacio() {
  if ((await Repuesto.countDocuments()) === 0) {
    await Repuesto.insertMany(SEMILLA_REPUESTOS);
    await Movimiento.insertMany(movimientosIniciales());
    logger.info(`Seed de repuestos insertado (${SEMILLA_REPUESTOS.length} documentos + movimientos iniciales).`);
  } else {
    logger.info("Seed de repuestos omitido: la colección ya tiene documentos.");
  }
}

// Solo laboratorio (LAB_ENDPOINTS=true): borra stock E historial. Con un
// inventario real esto no puede existir, por eso la ruta está detrás de la variable.
async function reiniciarRepuestos() {
  await Repuesto.deleteMany({});
  await Movimiento.deleteMany({});
  await Repuesto.insertMany(SEMILLA_REPUESTOS);
  await Movimiento.insertMany(movimientosIniciales());
  logger.warn("LABORATORIO: stock de repuestos y libro de movimientos restaurados a la semilla.");
}

module.exports = { IDS, SEMILLA_REPUESTOS, seedSiVacio, reiniciarRepuestos };
