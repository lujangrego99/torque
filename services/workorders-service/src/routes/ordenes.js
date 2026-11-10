const express = require("express");
const controlador = require("../controllers/ordenes");
const { autenticar } = require("../middleware/auth");

const router = express.Router();

// Express 4 no captura rechazos de funciones async: se pasan a next().
const capturar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Todo el recurso requiere identidad (MECANICO o ADMIN). La autorización fina es
// por propiedad: un MECANICO solo ve, edita, finaliza y cancela sus órdenes;
// ADMIN, todas (ver services/ordenes.js). Excepción: el historial del vehículo.
router.use(autenticar);

router.get("/", capturar(controlador.listar));
router.post("/", capturar(controlador.crear));
router.get("/vehiculo/:vehiculoId", capturar(controlador.historialVehiculo));
router.get("/:id", capturar(controlador.obtener));
router.patch("/:id", capturar(controlador.editar));
router.post("/:id/cancelar", capturar(controlador.cancelar));
router.post("/:id/finalizar", capturar(controlador.finalizar));
router.post("/:id/reponer", capturar(controlador.reponer));

module.exports = router;
