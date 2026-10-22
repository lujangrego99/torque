require("dotenv").config();

const { request, linea } = require("./http");
const IDS = require("../src/ids");

async function main() {
  linea("INFO — listado");
  console.log((await request("GET", "/api/vehiculos")).status);

  linea("WARN — id inválido");
  console.log((await request("GET", "/api/vehiculos/invalido")).status);

  linea("WARN — no encontrado");
  console.log((await request("GET", "/api/vehiculos/aaaaaaaaaaaaaaaaaaaaaaaa")).status);

  linea("WARN — validación");
  console.log(
    (
      await request("POST", "/api/vehiculos", {
        marca: "",
        modelo: "X",
        anio: 1800,
        patente: "??",
        kilometraje: -1,
      })
    ).status
  );

  linea("WARN — lock ocupado (si Redis está arriba)");
  await request("POST", "/api/repuestos/reiniciar");
  const lenta = request("POST", `/api/repuestos/${IDS.filtro}/descontar`, { cantidad: 1 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const ocupado = await request("POST", `/api/repuestos/${IDS.filtro}/descontar`, { cantidad: 1 });
  await lenta;
  console.log("ocupado", ocupado.status);

  linea("ERROR — ruta inexistente no es 500; forzar JSON malformado (400 WARN)");
  // El 500 se genera si Mongo/Redis fallan de forma inesperada. Para evidencia
  // de ERROR se usa el logger directo en demo-rotacion / arranque, y acá un 404.
  const nf = await request("GET", "/no-existe");
  console.log("404", nf.status);

  console.log("\nRevisar logs/app-*.log y logs/error-*.log");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
