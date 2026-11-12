// ¿Cada cuánto «se sale» el login? Prueba real con tiempos escalados 1:30
// (access 10 s ≈ 5 min, inactividad 30 s ≈ 15 min). Solo contra torque-defensa.
import { req, login, ADMIN, reconfigurar, escenario, log, guardarJson } from "./lib.mjs";
const ACCESS = "10s", IDLE = "30s";
const esperar = (s) => new Promise((r) => setTimeout(r, s * 1000));
escenario("S1", `Vencimiento de sesión (JWT_EXPIRES_IN=${ACCESS}, SESSION_IDLE=${IDLE})`);
reconfigurar("auth-service", { JWT_EXPIRES_IN: ACCESS, SESSION_IDLE: IDLE });
const filas = [];
const paso = (t, que, status) => { filas.push({ t, que, status }); log(`t=${String(t).padStart(3)}s  ${que} → ${status}`); };
try {
  let l = await login(ADMIN.email, ADMIN.password);
  paso(0, `login (expiresIn=${l.expiresIn}s)`, 200);
  paso(0, "GET /api/vehiculos con access", (await req("GET", "/api/vehiculos", { token: l.accessToken })).status);
  await esperar(12);
  paso(12, "mismo access a los 12 s (vencido)", (await req("GET", "/api/vehiculos", { token: l.accessToken })).status);
  let r = await req("POST", "/api/auth/refresh", { body: { refreshToken: l.refreshToken } });
  paso(12, "POST /refresh", r.status);
  paso(12, "access nuevo", (await req("GET", "/api/vehiculos", { token: r.body.accessToken })).status);
  // Uso activo: renovar cada 20 s durante 80 s (más que IDLE) → la sesión sigue viva.
  let rt = r.body.refreshToken, t = 12;
  for (let i = 0; i < 4; i++) {
    await esperar(20); t += 20;
    r = await req("POST", "/api/auth/refresh", { body: { refreshToken: rt } });
    paso(t, "refresh con uso activo (cada 20 s)", r.status);
    rt = r.body.refreshToken;
  }
  // Inactividad: 35 s sin renovar → la sesión vence.
  await esperar(35); t += 35;
  r = await req("POST", "/api/auth/refresh", { body: { refreshToken: rt } });
  paso(t, `refresh tras 35 s inactivo: ${r.body && r.body.error}`, r.status);
} finally {
  reconfigurar("auth-service", {}); // vuelve a lo del .env
}
guardarJson("S1-sesion", filas);
