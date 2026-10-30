const express = require("express");
const controlador = require("../controllers/ordenes");
const { autenticar } = require("../middleware/auth");

const router = express.Router();

// Express 4 no captura rechazos de funciones async: se pasan a next().
const capturar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Todo el recurso requiere identidad (MECANICO o ADMIN). La autorización fina es
// por propiedad: un MECANICO solo ve sus órdenes; ADMIN ve todas (ver services/ordenes.js).
router.use(autenticar);

router.get("/", capturar(controlador.listar));
router.post("/", capturar(controlador.crear));
router.get("/:id", capturar(controlador.obtener));

module.exports = router;
