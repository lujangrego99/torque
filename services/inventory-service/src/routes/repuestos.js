const express = require("express");
const controlador = require("../controllers/repuestos");

const router = express.Router();

// Express 4 no captura rechazos de funciones async: se pasan a next().
const capturar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/", capturar(controlador.listar));
router.post("/reiniciar", capturar(controlador.reiniciar));
router.get("/:id", capturar(controlador.obtener));
router.get("/:id/lock", capturar(controlador.estadoLock));
router.post("/:id/descontar-sin-lock", capturar(controlador.descontarSinLock));
router.post("/:id/descontar", capturar(controlador.descontar));

module.exports = router;
