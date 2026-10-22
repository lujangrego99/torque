require("dotenv").config();

const { request, linea } = require("./http");

async function main() {
  linea("GET /api-docs.json");
  const spec = await request("GET", "/api-docs.json");
  console.log("status:", spec.status);
  console.log("openapi:", spec.body && spec.body.openapi);
  console.log("title:", spec.body && spec.body.info && spec.body.info.title);
  console.log("paths:", spec.body && spec.body.paths && Object.keys(spec.body.paths));

  linea("GET /api-docs (Swagger UI)");
  const ui = await request("GET", "/api-docs/");
  console.log("status:", ui.status);
  const html = typeof ui.body === "string" ? ui.body : JSON.stringify(ui.body);
  console.log("es HTML:", html.includes("swagger-ui"));
  console.log("title snippet:", html.match(/<title>[^<]+<\/title>/));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
