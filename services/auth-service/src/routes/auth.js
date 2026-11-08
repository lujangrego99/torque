const express = require("express");
const controlador = require("../controllers/auth");
const { autenticar, autorizar } = require("../middleware/auth");

const router = express.Router();

// Express 4 no captura rechazos de funciones async: se pasan a next().
const capturar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Públicos: no hay registro abierto (requisito 1). Login emite access + refresh;
// refresh y logout se autentican con el refresh token (el access puede estar vencido).
router.post("/login", capturar(controlador.login));
router.post("/refresh", capturar(controlador.renovar));
router.post("/logout", capturar(controlador.cerrarSesion));

// Autenticado
router.get("/me", autenticar, capturar(controlador.perfil));

// ADMIN: alta administrada y administración de usuarios
router.post("/usuarios", autenticar, autorizar("ADMIN"), capturar(controlador.crearUsuario));
router.get("/usuarios", autenticar, autorizar("ADMIN"), capturar(controlador.listar));
router.patch("/usuarios/:id", autenticar, autorizar("ADMIN"), capturar(controlador.actualizar));

module.exports = router;
