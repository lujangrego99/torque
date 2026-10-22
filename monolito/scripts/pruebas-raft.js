/**
 * Smoke test del cluster: espera Leader, crea un vehículo y verifica
 * convergencia en los tres nodos (GET local).
 *
 * Uso: node scripts/pruebas-raft.js
 * Requiere: los tres nodos arriba + MongoDB.
 */

const NODES = [
  { id: "node1", http: "http://127.0.0.1:3100" },
  { id: "node2", http: "http://127.0.0.1:3101" },
  { id: "node3", http: "http://127.0.0.1:3102" },
];

async function json(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function statusDe(node) {
  return json(`${node.http}/api/raft/status`);
}

async function esperarLeader(maxMs = 15000) {
  const inicio = Date.now();
  while (Date.now() - inicio < maxMs) {
    const estados = [];
    for (const n of NODES) {
      try {
        const st = await statusDe(n);
        estados.push(st.body);
      } catch {
        estados.push(null);
      }
    }
    const leaders = estados.filter((s) => s && s.role === "LEADER");
    if (leaders.length === 1) {
      return { leader: leaders[0], estados };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("No se eligió un Leader único a tiempo.");
}

async function main() {
  console.log("Esperando Leader...");
  const { leader, estados } = await esperarLeader();
  console.log(
    "Estados:",
    estados.map((s) => (s ? `${s.nodeId}:${s.role}:term=${s.currentTerm}` : "down")).join(" | ")
  );

  const leaderNode = NODES.find((n) => n.id === leader.nodeId);
  const follower = NODES.find((n) => n.id !== leader.nodeId);

  const patente = `RAFT${String(Date.now()).slice(-4)}`;
  const create = await json(`${leaderNode.http}/api/vehiculos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marca: "Ford",
      modelo: "Focus",
      anio: 2019,
      patente,
      kilometraje: 40000,
    }),
  });
  console.log("POST Leader:", create.status, create.body && create.body.id);

  if (create.status !== 201) {
    process.exitCode = 1;
    return;
  }

  const rechazo = await json(`${follower.http}/api/vehiculos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marca: "X",
      modelo: "Y",
      anio: 2020,
      patente: "ZZZZZZ",
      kilometraje: 1,
    }),
  });
  console.log("POST Follower (esperado 503):", rechazo.status, rechazo.body && rechazo.body.leader);

  await new Promise((r) => setTimeout(r, 800));

  for (const n of NODES) {
    const lista = await json(`${n.http}/api/vehiculos`);
    const hay = Array.isArray(lista.body) && lista.body.some((v) => v.patente === patente);
    console.log(`GET ${n.id}: patente ${patente} presente=${hay}`);
    if (!hay) process.exitCode = 1;
  }

  const logs = await json(`${leaderNode.http}/api/raft/log`);
  console.log(
    "Log Leader committed entries:",
    (logs.body.entries || []).filter((e) => e.committed).length
  );

  console.log(process.exitCode ? "FALLÓ" : "OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
