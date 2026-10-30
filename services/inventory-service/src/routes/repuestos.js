const express = require("express");
const controlador = require("../controllers/repuestos");
const { autenticar, autorizar } = require("../middleware/auth");

const router = express.Router();

// Express 4 no captura rechazos de funciones async: se pasan a next().
const capturar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Público: catálogo de repuestos con stock (consulta, no modifica nada).
router.get("/", capturar(controlador.listar));
router.get("/:id", capturar(controlador.obtener));

// Solo ADMIN: operaciones de laboratorio/diagnóstico que alteran o exponen el estado interno.
router.post("/reiniciar", autenticar, autorizar("ADMIN"), capturar(controlador.reiniciar));
router.get("/:id/lock", autenticar, autorizar("ADMIN"), capturar(controlador.estadoLock));
router.post("/:id/descontar-sin-lock", autenticar, autorizar("ADMIN"), capturar(controlador.descontarSinLock));

// MECANICO y ADMIN: consumir stock (lo usa workorders-service con el token del usuario).
router.post("/:id/descontar", autenticar, autorizar("MECANICO", "ADMIN"), capturar(controlador.descontar));

module.exports = router;
