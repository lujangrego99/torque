const config = require("../config");

// Tabla de enrutamiento: prefijo público → servicio dueño.
// Es la única "regla" del gateway; no conoce patentes, stock ni órdenes.
const RUTAS = [
  { prefijo: "/api/vehiculos", servicio: config.servicios.vehicles },
  { prefijo: "/api/repuestos", servicio: config.servicios.inventory },
  { prefijo: "/api/ordenes", servicio: config.servicios.workorders },
  { prefijo: "/api/auth", servicio: config.servicios.auth },
];

function resolver(ruta) {
  return RUTAS.find((r) => ruta === r.prefijo || ruta.startsWith(`${r.prefijo}/`)) || null;
}

module.exports = { RUTAS, resolver };
