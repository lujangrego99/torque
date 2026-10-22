require("dotenv").config();

const { request, linea } = require("./http");
const IDS = require("../src/ids");

function patenteUnica() {
  const n = Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-6);
  return `ZZ${n}`.slice(0, 8);
}

async function main() {
  linea("GET /api/vehiculos");
  const listado = await request("GET", "/api/vehiculos");
  console.log(listado.status, JSON.stringify(listado.body));

  linea("GET id válido existente");
  const uno = await request("GET", `/api/vehiculos/${IDS.corolla}`);
  console.log(uno.status, JSON.stringify(uno.body));

  linea("GET id inválido (400)");
  const invalido = await request("GET", "/api/vehiculos/no-es-un-objectid");
  console.log(invalido.status, JSON.stringify(invalido.body));

  linea("GET id válido inexistente (404)");
  const inexistente = await request("GET", "/api/vehiculos/aaaaaaaaaaaaaaaaaaaaaaaa");
  console.log(inexistente.status, JSON.stringify(inexistente.body));

  const patente = patenteUnica();
  linea(`POST válido (201) patente=${patente}`);
  const creado = await request("POST", "/api/vehiculos", {
    marca: "Honda",
    modelo: "Civic",
    anio: 2020,
    patente,
    kilometraje: 30000,
  });
  console.log(creado.status, JSON.stringify(creado.body));
  const nuevoId = creado.body && creado.body.id;

  linea("POST patente duplicada (409)");
  const duplicado = await request("POST", "/api/vehiculos", {
    marca: "Honda",
    modelo: "Civic",
    anio: 2020,
    patente,
    kilometraje: 1,
  });
  console.log(duplicado.status, JSON.stringify(duplicado.body));

  linea("POST datos inválidos (400) — no debe crear");
  const malo = await request("POST", "/api/vehiculos", {
    marca: "",
    modelo: "X",
    anio: 1800,
    patente: "??",
    kilometraje: -5,
  });
  console.log(malo.status, JSON.stringify(malo.body));

  if (nuevoId) {
    linea("PUT kilometraje");
    const put = await request("PUT", `/api/vehiculos/${nuevoId}`, {
      marca: "Honda",
      modelo: "Civic",
      anio: 2020,
      patente,
      kilometraje: 31000,
    });
    console.log(put.status, JSON.stringify(put.body));

    linea("DELETE");
    const del = await request("DELETE", `/api/vehiculos/${nuevoId}`);
    console.log(del.status, JSON.stringify(del.body));

    linea("DELETE otra vez (404)");
    const del2 = await request("DELETE", `/api/vehiculos/${nuevoId}`);
    console.log(del2.status, JSON.stringify(del2.body));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
