const express = require("express");
const controlador = require("../controllers/ordenes");

const router = express.Router();

// Express 4 no captura rechazos de funciones async: se pasan a next().
const capturar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/", capturar(controlador.listar));
router.post("/", capturar(controlador.crear));
router.get("/:id", capturar(controlador.obtener));

module.exports = router;
