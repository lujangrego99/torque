/**
 * Cluster fijo de 3 nodos. La identidad local se elige con NODE_ID al arrancar
 * (sin editar código entre ejecuciones).
 */

const CLUSTER = {
  node1: {
    nodeId: "node1",
    port: 3100,
    httpsPort: 3443,
    raftPort: 7001,
    mongoDb: "taller_node1",
  },
  node2: {
    nodeId: "node2",
    port: 3101,
    httpsPort: 3444,
    raftPort: 7002,
    mongoDb: "taller_node2",
  },
  node3: {
    nodeId: "node3",
    port: 3102,
    httpsPort: 3445,
    raftPort: 7003,
    mongoDb: "taller_node3",
  },
};

function cargarConfig() {
  const nodeId = process.env.NODE_ID || "node1";
  const local = CLUSTER[nodeId];
  if (!local) {
    throw new Error(
      `NODE_ID inválido: "${nodeId}". Valores permitidos: ${Object.keys(CLUSTER).join(", ")}`
    );
  }

  const host = process.env.CLUSTER_HOST || "127.0.0.1";
  const peers = Object.values(CLUSTER)
    .filter((n) => n.nodeId !== nodeId)
    .map((n) => ({
      nodeId: n.nodeId,
      raftUrl: `http://${host}:${n.raftPort}`,
      apiHttp: `http://${host}:${n.port}`,
      apiHttps: `https://${host}:${n.httpsPort}`,
    }));

  const electionTimeoutMin = Number(process.env.ELECTION_TIMEOUT_MIN_MS) || 1500;
  const electionTimeoutMax = Number(process.env.ELECTION_TIMEOUT_MAX_MS) || 3000;
  const heartbeatInterval = Number(process.env.HEARTBEAT_INTERVAL_MS) || 500;

  return {
    ...local,
    host,
    peers,
    clusterSize: Object.keys(CLUSTER).length,
    majority: Math.floor(Object.keys(CLUSTER).length / 2) + 1,
    electionTimeoutMin,
    electionTimeoutMax,
    heartbeatInterval,
    mongoUri:
      process.env.MONGODB_URI ||
      `mongodb://127.0.0.1:27017/${local.mongoDb}`,
    apiHttp: `http://${host}:${local.port}`,
    apiHttps: `https://${host}:${local.httpsPort}`,
    raftUrl: `http://${host}:${local.raftPort}`,
  };
}

function catalogoCluster() {
  return { ...CLUSTER };
}

module.exports = {
  cargarConfig,
  catalogoCluster,
  CLUSTER,
};
