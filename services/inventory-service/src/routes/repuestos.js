const express = require("express");
const config = require("../config");
const controlador = require("../controllers/repuestos");
const { autenticar, autorizar } = require("../middleware/auth");

const router = express.Router();

// Express 4 no captura rechazos de funciones async: se pasan a next().
const capturar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// La autenticación se aplica a cada ruta registrada. Así las rutas de
// laboratorio deshabilitadas responden 404 incluso sin token.
const TODOS = [autenticar, autorizar("MECANICO", "ADMIN")];
const ADMIN = [autenticar, autorizar("ADMIN")];

// Laboratorio (requisito 16): solo existen con LAB_ENDPOINTS=true. Sin la
// variable no se registran (404): reiniciar borraría stock e historial reales.
// Van antes de "/:id" para que "reiniciar" no se tome como id.
if (config.labEndpoints) {
  router.post("/reiniciar", ADMIN, capturar(controlador.reiniciar));
  router.get("/:id/lock", ADMIN, capturar(controlador.estadoLock));
  router.post("/:id/descontar-sin-lock", ADMIN, capturar(controlador.descontarSinLock));
}

// Consulta (MECANICO y ADMIN)
router.get("/", TODOS, capturar(controlador.listar));
router.get("/movimientos", TODOS, capturar(controlador.movimientos));
router.get("/:id", TODOS, capturar(controlador.obtener));

// Alta, ingreso y ajuste: solo ADMIN (requisitos 6 y 7)
router.post("/", ADMIN, capturar(controlador.crear));
router.post("/:id/ingreso", ADMIN, capturar(controlador.ingreso));
router.post("/:id/ajuste", ADMIN, capturar(controlador.ajuste));

// Consumo y devolución por órdenes de trabajo (los usa workorders-service con el
// token del usuario). La propiedad de la reposición se valida contra el libro.
router.post("/reposiciones", TODOS, capturar(controlador.reponer));
router.post("/:id/descontar", TODOS, capturar(controlador.descontar));

module.exports = router;
