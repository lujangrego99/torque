const express = require("express");
const controlador = require("../controllers/vehiculos");
const { autenticar, autorizar } = require("../middleware/auth");

const router = express.Router();

// Express 4 no captura rechazos de funciones async: se pasan a next().
const capturar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Todo el recurso requiere identidad: los datos del parque (patentes) no son públicos.
router.use(autenticar);

// MECANICO y ADMIN: recibir, consultar y actualizar vehículos es tarea diaria del taller.
router.get("/", capturar(controlador.listar));
router.get("/:id", capturar(controlador.obtener));
router.post("/", capturar(controlador.crear));
router.put("/:id", capturar(controlador.reemplazar));

// Solo ADMIN: la baja borra el vehículo y deja órdenes con una referencia huérfana.
router.delete("/:id", autorizar("ADMIN"), capturar(controlador.eliminar));

module.exports = router;
