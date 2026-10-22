const https = require("https");

const PORT = Number(process.env.HTTPS_PORT) || 3443;
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function request(method, pathname, body) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "localhost",
        port: PORT,
        path: pathname,
        method,
        agent,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let parsed = data;
          try {
            parsed = data ? JSON.parse(data) : data;
          } catch (err) {
            parsed = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function linea(titulo) {
  console.log("\n=== " + titulo + " ===");
}

module.exports = {
  request,
  linea,
  PORT,
};
