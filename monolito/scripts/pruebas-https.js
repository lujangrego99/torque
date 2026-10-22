const https = require("https");

const PORT = Number(process.env.HTTPS_PORT) || 3443;
const agent = new https.Agent({ rejectUnauthorized: false });

function pedir(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "localhost",
        port: PORT,
        path: pathname,
        method: "GET",
        agent,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            authorized: res.socket.authorized,
            protocol: res.socket.getProtocol && res.socket.getProtocol(),
            cert: res.socket.getPeerCertificate && res.socket.getPeerCertificate(),
            body,
          });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

pedir("/")
  .then((r) => {
    const c = r.cert || {};
    console.log("status:", r.status);
    console.log("tls:", r.protocol);
    console.log("authorized (CA del sistema):", r.authorized);
    console.log("subject:", c.subject);
    console.log("issuer:", c.issuer);
    console.log("valid_from:", c.valid_from);
    console.log("valid_to:", c.valid_to);
    console.log("body:", r.body);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
