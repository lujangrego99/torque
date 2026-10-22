/**
 * Genera evidencias textuales A–I del TP4.
 * Los nodos deben estar corriendo (o este script los arranca si --start).
 *
 * node scripts/generar-evidencias-raft.js
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "evidencias");
const NODES = [
  { id: "node1", http: "http://127.0.0.1:3100", port: 3100 },
  { id: "node2", http: "http://127.0.0.1:3101", port: 3101 },
  { id: "node3", http: "http://127.0.0.1:3102", port: 3102 },
];

const children = [];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function write(name, content) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  console.log("wrote", name);
}

async function json(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

async function statusAll() {
  const rows = [];
  for (const n of NODES) {
    try {
      const r = await json(`${n.http}/api/raft/status`);
      rows.push({ node: n.id, ok: true, status: r.status, body: r.body });
    } catch (err) {
      rows.push({ node: n.id, ok: false, error: err.message });
    }
  }
  return rows;
}

async function esperarLeader(maxMs = 20000) {
  const inicio = Date.now();
  while (Date.now() - inicio < maxMs) {
    const rows = await statusAll();
    const leaders = rows.filter((r) => r.ok && r.body && r.body.role === "LEADER");
    const up = rows.filter((r) => r.ok).length;
    if (leaders.length === 1 && up >= 2) {
      return { leader: leaders[0].body, rows };
    }
    await sleep(400);
  }
  throw new Error("No hubo Leader a tiempo");
}

function startNode(nodeId) {
  // Quitar entradas previas del mismo id
  for (let i = children.length - 1; i >= 0; i -= 1) {
    if (children[i].nodeId === nodeId) {
      children.splice(i, 1);
    }
  }
  const child = spawn("node", ["src/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ID: nodeId,
      DEMO_DELAY_MS: process.env.DEMO_DELAY_MS || "500",
      // Evitar locks de winston entre procesos en /mnt/c
      LOG_DIR: path.join("/tmp/tp04-raft-logs", nodeId),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const buf = { out: "", err: "" };
  child.stdout.on("data", (d) => {
    buf.out += d.toString();
  });
  child.stderr.on("data", (d) => {
    buf.err += d.toString();
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${nodeId}] exit ${code}\n${buf.err || buf.out}`);
    }
  });
  children.push({ nodeId, child, buf });
  return child;
}

async function stopNode(nodeId) {
  const entry = children.find((c) => c.nodeId === nodeId && c.child.exitCode === null);
  if (!entry) return;
  try {
    entry.child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  await sleep(1200);
  if (entry.child.exitCode === null) {
    try {
      entry.child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    await sleep(500);
  }
}

async function stopAll() {
  for (const c of [...children]) {
    await stopNode(c.nodeId);
  }
  children.length = 0;
}

async function waitHttp(url, maxMs = 60000) {
  const inicio = Date.now();
  while (Date.now() - inicio < maxMs) {
    try {
      await json(url);
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Timeout esperando ${url}`);
}

async function waitNode(nodeId, maxMs = 60000) {
  const n = NODES.find((x) => x.id === nodeId);
  const entry = children.find((c) => c.nodeId === nodeId);
  const inicio = Date.now();
  while (Date.now() - inicio < maxMs) {
    if (entry && entry.child.exitCode !== null) {
      throw new Error(
        `${nodeId} salió con código ${entry.child.exitCode}: ${entry.buf.err || entry.buf.out}`
      );
    }
    try {
      await json(`${n.http}/api/raft/status`);
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(
    `Timeout esperando ${nodeId}. stderr=${entry && entry.buf.err} stdout=${entry && entry.buf.out}`
  );
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  console.log("Arrancando 3 nodos...");
  startNode("node1");
  startNode("node2");
  startNode("node3");
  await waitNode("node1");
  await waitNode("node2");
  await waitNode("node3");

  // A
  const a = await esperarLeader();
  write(
    "A-arranque-leader.txt",
    [
      "# Escenario A — Arranque de tres nodos / Leader elegido",
      `fecha: ${new Date().toISOString()}`,
      "",
      pretty(a.rows.map((r) => (r.ok ? r.body : r))),
    ].join("\n")
  );

  const leaderHttp = a.leader.apiHttp;
  const follower = NODES.find((n) => n.id !== a.leader.nodeId);

  // B
  const b = await json(`${follower.http}/api/vehiculos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marca: "X",
      modelo: "Y",
      anio: 2020,
      patente: "FF111GG",
      kilometraje: 1,
    }),
  });
  write(
    "B-escritura-follower-503.txt",
    [
      "# Escenario B — Escritura sobre follower (no aplica local)",
      `follower: ${follower.id} ${follower.http}`,
      `HTTP ${b.status}`,
      pretty(b.body),
    ].join("\n")
  );

  // C
  const patente = `EV${String(Date.now()).slice(-6)}`;
  const created = await json(`${leaderHttp}/api/vehiculos`, {
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
  await sleep(600);
  const lists = {};
  for (const n of NODES) {
    lists[n.id] = await json(`${n.http}/api/vehiculos`);
  }
  const id = created.body && created.body.id;
  const put = await json(`${leaderHttp}/api/vehiculos/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marca: "Ford",
      modelo: "Focus",
      anio: 2019,
      patente,
      kilometraje: 41000,
    }),
  });
  await sleep(500);
  const afterPut = {};
  for (const n of NODES) {
    afterPut[n.id] = await json(`${n.http}/api/vehiculos/${id}`);
  }
  const logLeader = await json(`${leaderHttp}/api/raft/log`);
  write(
    "C-crud-leader-convergencia.txt",
    [
      "# Escenario C — CRUD sobre Leader y convergencia",
      `leader: ${a.leader.nodeId} ${leaderHttp}`,
      "",
      "## POST",
      `HTTP ${created.status}`,
      pretty(created.body),
      "",
      "## GET listado (tras commit)",
      ...NODES.map(
        (n) =>
          `${n.id}: status=${lists[n.id].status} contienePatente=${
            Array.isArray(lists[n.id].body) && lists[n.id].body.some((v) => v.patente === patente)
          }`
      ),
      "",
      "## PUT kilometraje=41000",
      `HTTP ${put.status}`,
      pretty(put.body),
      "",
      "## GET por id en cada nodo",
      pretty(
        Object.fromEntries(
          NODES.map((n) => [n.id, afterPut[n.id].body && afterPut[n.id].body.kilometraje])
        )
      ),
      "",
      "## Log Leader",
      pretty(logLeader.body),
    ].join("\n")
  );

  // OpenAPI / swagger evidence (texto)
  const openapi = await json(`${leaderHttp}/api-docs.json`);
  write(
    "swagger-openapi-paths.txt",
    [
      "# OpenAPI — paths relevantes Raft",
      `HTTP ${openapi.status}`,
      "paths:",
      ...Object.keys((openapi.body && openapi.body.paths) || {})
        .filter((p) => p.includes("raft") || p.includes("vehiculo") || p.includes("descontar"))
        .map((p) => `- ${p}`),
      "",
      `info.version=${openapi.body && openapi.body.info && openapi.body.info.version}`,
      `title=${openapi.body && openapi.body.info && openapi.body.info.title}`,
    ].join("\n")
  );

  // D — caer Leader
  const oldLeader = a.leader.nodeId;
  write(
    "D-caida-leader-antes.txt",
    [`# Escenario D — estado antes de matar Leader ${oldLeader}`, pretty(await statusAll())].join(
      "\n"
    )
  );
  await stopNode(oldLeader);
  await sleep(4500);
  const afterFail = await esperarLeader(20000);
  write(
    "D-caida-leader-despues.txt",
    [
      `# Escenario D — tras caer ${oldLeader}`,
      `nuevoLeader=${afterFail.leader.nodeId} term=${afterFail.leader.currentTerm}`,
      pretty(afterFail.rows.map((r) => (r.ok ? r.body : r))),
    ].join("\n")
  );

  const leader2 = afterFail.leader.apiHttp;

  // E — quorum 2/3 (old leader still down)
  const patenteE = `Q2${String(Date.now()).slice(-5)}`;
  const eCreate = await json(`${leader2}/api/vehiculos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marca: "Chevrolet",
      modelo: "Onix",
      anio: 2021,
      patente: patenteE,
      kilometraje: 1000,
    }),
  });
  await sleep(500);
  const eLogs = {};
  for (const n of NODES) {
    if (n.id === oldLeader) continue;
    eLogs[n.id] = await json(`${n.http}/api/raft/log`);
  }
  write(
    "E-quorum-2de3.txt",
    [
      "# Escenario E — Quorum 2/3 (Leader + 1 follower)",
      `leaderDown=${oldLeader}`,
      `POST HTTP ${eCreate.status}`,
      pretty(eCreate.body),
      "",
      "## logs (committed)",
      pretty(
        Object.fromEntries(
          Object.entries(eLogs).map(([id, r]) => [
            id,
            (r.body.entries || []).filter((e) => e.committed).map((e) => e.index),
          ])
        )
      ),
    ].join("\n")
  );

  // F — sin quorum 1/3: dejar solo el leader actual
  const survivors = NODES.filter((n) => n.id !== oldLeader).map((n) => n.id);
  const toKill = survivors.find((id) => id !== afterFail.leader.nodeId);
  await stopNode(toKill);
  await sleep(1000);
  const patenteF = `Q1${String(Date.now()).slice(-5)}`;
  let fCreate;
  try {
    fCreate = await json(`${leader2}/api/vehiculos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        marca: "Solo",
        modelo: "Uno",
        anio: 2010,
        patente: patenteF,
        kilometraje: 1,
      }),
    });
  } catch (err) {
    fCreate = { status: 0, body: { error: err.message } };
  }
  const fLog = await json(`${leader2}/api/raft/log`);
  write(
    "F-sin-quorum-1de3.txt",
    [
      "# Escenario F — Sin quorum 1/3 (no debe confirmar)",
      `activos: solo ${afterFail.leader.nodeId}`,
      `POST HTTP ${fCreate.status}`,
      pretty(fCreate.body),
      "",
      "## log local (committed vs no)",
      pretty(fLog.body),
      "",
      "Nota: con un solo nodo no hay mayoría (2). La escritura no debe confirmarse.",
    ].join("\n")
  );

  // G — follower atrasado: levantar el que matamos en F + old leader sigue down;
  // mejor: subir oldLeader que está atrasado, con 2 nodos vivos hacer más ops, luego up
  // Reiniciar toKill (atrasado respecto de writes E) y oldLeader
  // Primero subir toKill (estuvo offline durante intento F; E sí pudo haber visto)
  // Clearer G: stop one follower while 2 run, write, restart follower.

  // Subir los dos caídos para estabilizar, luego escenario G limpio
  await sleep(2000);
  startNode(toKill);
  await waitNode(toKill);
  startNode(oldLeader);
  await waitNode(oldLeader);
  await sleep(3500);
  const gReady = await esperarLeader();

  const lagging = NODES.find((n) => n.id !== gReady.leader.nodeId);
  await stopNode(lagging.id);
  await sleep(800);
  const patenteG = `LAG${String(Date.now()).slice(-4)}`;
  const gCreate = await json(`${gReady.leader.apiHttp}/api/vehiculos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marca: "Fiat",
      modelo: "Cronos",
      anio: 2022,
      patente: patenteG,
      kilometraje: 500,
    }),
  });
  const logAntes = await json(`${gReady.leader.apiHttp}/api/raft/log`);
  startNode(lagging.id);
  await waitNode(lagging.id);
  await sleep(3000);
  const logFollower = await json(`${lagging.http}/api/raft/log`);
  const getFollower = await json(`${lagging.http}/api/vehiculos`);
  write(
    "G-follower-atrasado.txt",
    [
      "# Escenario G — Follower atrasado recupera entradas",
      `followerAtrasado=${lagging.id}`,
      `POST mientras estaba down: HTTP ${gCreate.status} patente=${patenteG}`,
      "",
      "## log Leader al momento de la escritura",
      pretty(logAntes.body),
      "",
      "## log follower tras reinicio",
      pretty(logFollower.body),
      "",
      `contiene patente en GET: ${
        Array.isArray(getFollower.body) && getFollower.body.some((v) => v.patente === patenteG)
      }`,
    ].join("\n")
  );

  // H — restart completo
  const hBefore = await statusAll();
  const hLog = await json(`${(await esperarLeader()).leader.apiHttp}/api/raft/log`);
  write(
    "H-restart-antes.txt",
    ["# Escenario H — estado antes del restart completo", pretty(hBefore), "", pretty(hLog.body)].join(
      "\n"
    )
  );
  await stopAll();
  await sleep(2500);
  startNode("node1");
  startNode("node2");
  startNode("node3");
  await waitNode("node1");
  await waitNode("node2");
  await waitNode("node3");
  const hAfter = await esperarLeader();
  const listsH = {};
  for (const n of NODES) {
    listsH[n.id] = await json(`${n.http}/api/vehiculos`);
  }
  write(
    "H-restart-despues.txt",
    [
      "# Escenario H — tras reinicio completo (sin borrar Mongo)",
      `leader=${hAfter.leader.nodeId} term=${hAfter.leader.currentTerm}`,
      "El término no debe retroceder respecto del estado previo.",
      "",
      pretty(hAfter.rows.map((r) => (r.ok ? r.body : r))),
      "",
      "## cantidad de vehículos por nodo (estado committed persistido)",
      pretty(
        Object.fromEntries(
          NODES.map((n) => [
            n.id,
            Array.isArray(listsH[n.id].body) ? listsH[n.id].body.length : listsH[n.id],
          ])
        )
      ),
      "",
      `patente del escenario C aún presente en node1: ${
        Array.isArray(listsH.node1.body) && listsH.node1.body.some((v) => v.patente === patente)
      }`,
    ].join("\n")
  );

  // I — Redis + Raft
  const leaderI = hAfter.leader;
  const reps = await json(`${leaderI.apiHttp}/api/repuestos`);
  // Preferir pastillas (stock alto en seed) para no depender de reiniciar local.
  const item =
    (Array.isArray(reps.body) && reps.body.find((r) => r.codigo === "PAS-FRE-002")) ||
    (Array.isArray(reps.body) && reps.body.find((r) => (r.stock || 0) > 0));
  let iResult = { note: "no se encontró repuesto con stock" };
  if (item) {
    const d1 = json(`${leaderI.apiHttp}/api/repuestos/${item.id}/descontar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cantidad: 1 }),
    });
    const d2 = json(`${leaderI.apiHttp}/api/repuestos/${item.id}/descontar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cantidad: 1 }),
    });
    const [r1, r2] = await Promise.all([d1, d2]);
    await sleep(1000);
    const stockNodos = {};
    for (const n of NODES) {
      const one = await json(`${n.http}/api/repuestos/${item.id}`);
      stockNodos[n.id] = one.body && one.body.stock;
    }
    const logI = await json(`${leaderI.apiHttp}/api/raft/log`);
    iResult = {
      repuesto: { id: item.id, codigo: item.codigo, stockAntes: item.stock },
      concurrentes: [
        { status: r1.status, body: r1.body },
        { status: r2.status, body: r2.body },
      ],
      stockPorNodo: stockNodos,
      ultimasEntradas: (logI.body.entries || []).slice(-5),
    };
  }
  write(
    "I-redis-raft-descontar.txt",
    [
      "# Escenario I — Integración Redis (lock) + Raft (commit)",
      "Dos POST concurrentes a /descontar: uno adquiere el lock; la modificación aceptada entra al log Raft.",
      "",
      pretty(iResult),
    ].join("\n")
  );

  // DELETE evidencia corta del CRUD
  if (id) {
    const leaderNow = (await esperarLeader()).leader.apiHttp;
    const del = await json(`${leaderNow}/api/vehiculos/${id}`, { method: "DELETE" });
    write(
      "C-delete-leader.txt",
      [`# DELETE del vehículo creado en C`, `HTTP ${del.status}`, del.text || "(sin body)"].join("\n")
    );
  }

  write(
    "README.md",
    [
      "# Evidencias TP4 — Consenso Raft",
      "",
      "Generadas con `node scripts/generar-evidencias-raft.js`.",
      "",
      "| Archivo | Escenario |",
      "|---|---|",
      "| A-arranque-leader.txt | A — Leader + 2 followers |",
      "| B-escritura-follower-503.txt | B — escritura a follower |",
      "| C-crud-leader-convergencia.txt | C — CRUD + convergencia |",
      "| C-delete-leader.txt | C — DELETE |",
      "| D-caida-leader-antes.txt / D-caida-leader-despues.txt | D — failover |",
      "| E-quorum-2de3.txt | E — quorum 2/3 |",
      "| F-sin-quorum-1de3.txt | F — sin quorum 1/3 |",
      "| G-follower-atrasado.txt | G — recovery follower |",
      "| H-restart-antes.txt / H-restart-despues.txt | H — restart completo |",
      "| I-redis-raft-descontar.txt | I — Redis + Raft |",
      "| swagger-openapi-paths.txt | OpenAPI paths |",
      "| swagger-ui.png | Swagger UI (si existe) |",
      "",
    ].join("\n")
  );

  console.log("Evidencias OK. Dejando nodos corriendo para captura Swagger...");
  // keep nodes up for screenshot
}

main().catch(async (err) => {
  console.error(err);
  await stopAll();
  process.exit(1);
});
