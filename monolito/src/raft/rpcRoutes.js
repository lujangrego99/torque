const express = require("express");

function crearRaftRpcRouter(getNode) {
  const router = express.Router();

  router.post("/request-vote", async (req, res, next) => {
    try {
      const node = getNode();
      const respuesta = await node.handleRequestVote(req.body || {});
      return res.status(200).json(respuesta);
    } catch (err) {
      return next(err);
    }
  });

  router.post("/append-entries", async (req, res, next) => {
    try {
      const node = getNode();
      const respuesta = await node.handleAppendEntries(req.body || {});
      return res.status(200).json(respuesta);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { crearRaftRpcRouter };
