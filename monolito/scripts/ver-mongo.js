require("dotenv").config();

const { conectar, desconectar } = require("../src/mongo");
const Vehiculo = require("../src/models/vehiculo");
const Repuesto = require("../src/models/repuesto");
const { serializarVehiculo, serializarRepuesto } = require("../src/utils/serializar");

async function main() {
  await conectar();
  const vehiculos = await Vehiculo.find().sort({ patente: 1 });
  const repuestos = await Repuesto.find().sort({ codigo: 1 });
  console.log("db:", require("mongoose").connection.name);
  console.log("vehiculos:", JSON.stringify(vehiculos.map(serializarVehiculo), null, 2));
  console.log("repuestos:", JSON.stringify(repuestos.map(serializarRepuesto), null, 2));
  await desconectar();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
