const express = require("express");

function crearRaftDiagRouter(getNode) {
  const router = express.Router();

  router.get("/status", (req, res) => {
    const node = getNode();
    return res.status(200).json(node.status());
  });

  router.get("/log", (req, res) => {
    const node = getNode();
    return res.status(200).json(node.logSnapshot());
  });

  return router;
}

function responderNoLeader(res, node) {
  const leader = node.infoLeader();
  return res.status(503).json({
    error: "Este nodo no es el Leader. Reintentar la escritura en el Leader.",
    role: node.role,
    nodeId: node.nodeId,
    leader,
  });
}

module.exports = {
  crearRaftDiagRouter,
  responderNoLeader,
};
