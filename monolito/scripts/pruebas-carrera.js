require("dotenv").config();

const { request, linea } = require("./http");
const IDS = require("../src/ids");

async function mostrarStock(etiqueta) {
  const r = await request("GET", "/api/repuestos");
  const resumido = Array.isArray(r.body)
    ? r.body.map((item) => ({ id: item.id, codigo: item.codigo, stock: item.stock }))
    : r.body;
  console.log(etiqueta, JSON.stringify(resumido));
  return r.body;
}

async function main() {
  const escenario = process.argv[2] || "todo";
  const filtro = `/api/repuestos/${IDS.filtro}`;
  const pastillas = `/api/repuestos/${IDS.pastillas}`;

  if (escenario === "reiniciar" || escenario === "todo") {
    linea("Reiniciar stock");
    console.log(await request("POST", "/api/repuestos/reiniciar"));
  }

  if (escenario === "sin-lock" || escenario === "todo") {
    await request("POST", "/api/repuestos/reiniciar");
    linea("Carrera SIN lock (dos descuentos simultáneos del filtro, stock inicial 1)");
    await mostrarStock("antes");
    const t0 = Date.now();
    const [a, b] = await Promise.all([
      request("POST", `${filtro}/descontar-sin-lock`, { cantidad: 1 }),
      request("POST", `${filtro}/descontar-sin-lock`, { cantidad: 1 }),
    ]);
    console.log("duración ms:", Date.now() - t0);
    console.log("A", a.status, JSON.stringify(a.body));
    console.log("B", b.status, JSON.stringify(b.body));
    await mostrarStock("después");
  }

  if (escenario === "con-lock" || escenario === "todo") {
    await request("POST", "/api/repuestos/reiniciar");
    linea("Con lock (dos descuentos simultáneos del filtro, stock inicial 1)");
    await mostrarStock("antes");
    const t0 = Date.now();
    const [a, b] = await Promise.all([
      request("POST", `${filtro}/descontar`, { cantidad: 1 }),
      request("POST", `${filtro}/descontar`, { cantidad: 1 }),
    ]);
    console.log("duración ms:", Date.now() - t0);
    console.log("A", a.status, JSON.stringify(a.body));
    console.log("B", b.status, JSON.stringify(b.body));
    await mostrarStock("después");
  }

  if (escenario === "granularidad" || escenario === "todo") {
    await request("POST", "/api/repuestos/reiniciar");
    linea("Granularidad (filtro y pastillas a la vez)");
    await mostrarStock("antes");
    const t0 = Date.now();
    const [a, b] = await Promise.all([
      request("POST", `${filtro}/descontar`, { cantidad: 1 }),
      request("POST", `${pastillas}/descontar`, { cantidad: 1 }),
    ]);
    console.log("duración ms:", Date.now() - t0);
    console.log("filtro", a.status, JSON.stringify(a.body));
    console.log("pastillas", b.status, JSON.stringify(b.body));
    await mostrarStock("después");
  }

  if (escenario === "ocupado" || escenario === "todo") {
    await request("POST", "/api/repuestos/reiniciar");
    linea("Recurso ocupado (segunda solicitud mientras el lock está tomado)");
    const lenta = request("POST", `${filtro}/descontar`, { cantidad: 1 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const inspeccion = await request("GET", `${filtro}/lock`);
    const rapida = await request("POST", `${filtro}/descontar`, { cantidad: 1 });
    const primera = await lenta;
    console.log("lock durante la primera:", JSON.stringify(inspeccion.body));
    console.log("primera", primera.status, JSON.stringify(primera.body));
    console.log("segunda (esperada 409)", rapida.status, JSON.stringify(rapida.body));
    await mostrarStock("después");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
