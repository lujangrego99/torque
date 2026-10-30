const express = require("express");
const controlador = require("../controllers/auth");
const { autenticar, autorizar } = require("../middleware/auth");

const router = express.Router();

// Express 4 no captura rechazos de funciones async: se pasan a next().
const capturar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Públicos
router.post("/register", capturar(controlador.registrar));
router.post("/login", capturar(controlador.login));

// Autenticado
router.get("/me", autenticar, capturar(controlador.perfil));

// ADMIN
router.get("/usuarios", autenticar, autorizar("ADMIN"), capturar(controlador.listar));
router.patch("/usuarios/:id", autenticar, autorizar("ADMIN"), capturar(controlador.actualizar));

module.exports = router;
