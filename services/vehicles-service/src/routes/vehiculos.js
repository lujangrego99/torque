const express = require("express");
const controlador = require("../controllers/vehiculos");

const router = express.Router();

// Express 4 no captura rechazos de funciones async: se pasan a next().
const capturar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/", capturar(controlador.listar));
router.get("/:id", capturar(controlador.obtener));
router.post("/", capturar(controlador.crear));
router.put("/:id", capturar(controlador.reemplazar));
router.delete("/:id", capturar(controlador.eliminar));

module.exports = router;
