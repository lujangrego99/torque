require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { request, linea } = require("./http");

const ESTADO = path.resolve(__dirname, "..", "evidencias", ".persistencia-id.json");

function patenteUnica() {
  const n = Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-5);
  return `PP${n}`.slice(0, 8);
}

async function crear() {
  const patente = patenteUnica();
  linea("Crear vehículo para prueba de persistencia");
  const creado = await request("POST", "/api/vehiculos", {
    marca: "Chevrolet",
    modelo: "Onix",
    anio: 2022,
    patente,
    kilometraje: 15000,
  });
  console.log(creado.status, JSON.stringify(creado.body));
  if (creado.status !== 201 || !creado.body.id) {
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(ESTADO), { recursive: true });
  fs.writeFileSync(ESTADO, JSON.stringify({ id: creado.body.id, patente }, null, 2));
  console.log("Guardado en", ESTADO);
  console.log("Reiniciar Node y correr: npm run pruebas:persistencia verificar");
}

async function verificar() {
  if (!fs.existsSync(ESTADO)) {
    console.error("No hay id guardado. Correr primero: npm run pruebas:persistencia crear");
    process.exit(1);
  }
  const { id, patente } = JSON.parse(fs.readFileSync(ESTADO, "utf8"));
  linea(`GET luego del reinicio id=${id}`);
  const r = await request("GET", `/api/vehiculos/${id}`);
  console.log(r.status, JSON.stringify(r.body));
  if (r.status === 200 && r.body.patente === patente) {
    console.log("PERSISTENCIA OK: el documento sigue en MongoDB después de reiniciar Node.");
  } else {
    console.error("PERSISTENCIA FALLÓ.");
    process.exit(1);
  }
}

async function main() {
  const modo = process.argv[2] || "crear";
  if (modo === "crear") {
    await crear();
  } else if (modo === "verificar") {
    await verificar();
  } else {
    console.error("Uso: node scripts/pruebas-persistencia.js crear|verificar");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
