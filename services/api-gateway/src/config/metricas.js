// Métricas en memoria del proceso (observabilidad). Es el mismo archivo en
// cada servicio: cuenta pedidos, errores y tiempos de respuesta, en total y por
// ruta, y los expone en GET /metrics (JSON) o GET /metrics?formato=prometheus.
//
// No reemplaza a los logs: los logs cuentan QUÉ pasó con un pedido (rid); las
// métricas dicen CUÁNTO y CUÁN RÁPIDO, para ver de un vistazo qué servicio anda
// lento o falla. Se reinician con el proceso (no se persisten).

const MUESTRAS = 1000; // últimos N tiempos para calcular percentiles

const inicio = Date.now();
const totales = { pedidos: 0, errores4xx: 0, errores5xx: 0, enCurso: 0, msTotal: 0, msMax: 0 };
const porStatus = {};
const porRuta = {};
const ultimas = [];

// Ruta "plantilla" (/api/repuestos/:id), no la URL real: así un id distinto no
// crea una entrada nueva por cada pedido.
function plantilla(req) {
  if (req.route && req.route.path) return `${req.method} ${req.baseUrl}${req.route.path === "/" ? "" : req.route.path}`;
  return `${req.method} (sin ruta)`;
}

function middleware(req, res, next) {
  if (req.path === "/metrics" || req.path === "/health") return next();
  const t0 = process.hrtime.bigint();
  totales.enCurso += 1;
  res.on("close", () => {
    totales.enCurso -= 1;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const status = res.statusCode;
    totales.pedidos += 1;
    totales.msTotal += ms;
    totales.msMax = Math.max(totales.msMax, ms);
    if (status >= 500) totales.errores5xx += 1;
    else if (status >= 400) totales.errores4xx += 1;
    porStatus[status] = (porStatus[status] || 0) + 1;

    const clave = res.locals.rutaMetrica || plantilla(req);
    const r = (porRuta[clave] = porRuta[clave] || { pedidos: 0, errores: 0, msTotal: 0, msMax: 0 });
    r.pedidos += 1;
    if (status >= 500) r.errores += 1;
    r.msTotal += ms;
    r.msMax = Math.max(r.msMax, ms);

    ultimas.push(ms);
    if (ultimas.length > MUESTRAS) ultimas.shift();
  });
  next();
}

function percentil(p) {
  if (!ultimas.length) return 0;
  const orden = [...ultimas].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1)];
}

const r2 = (n) => Math.round(n * 100) / 100;

function instantanea(servicio) {
  const mem = process.memoryUsage();
  return {
    servicio,
    desde: new Date(inicio).toISOString(),
    uptimeSegundos: Math.round((Date.now() - inicio) / 1000),
    pedidos: {
      total: totales.pedidos,
      enCurso: totales.enCurso,
      errores4xx: totales.errores4xx,
      errores5xx: totales.errores5xx,
      tasaError5xx: totales.pedidos ? r2(totales.errores5xx / totales.pedidos) : 0,
      porStatus,
    },
    tiempoRespuestaMs: {
      promedio: totales.pedidos ? r2(totales.msTotal / totales.pedidos) : 0,
      p50: r2(percentil(50)),
      p95: r2(percentil(95)),
      p99: r2(percentil(99)),
      max: r2(totales.msMax),
      muestras: ultimas.length,
    },
    porRuta: Object.fromEntries(
      Object.entries(porRuta)
        .sort((a, b) => b[1].pedidos - a[1].pedidos)
        .map(([k, v]) => [k, { pedidos: v.pedidos, errores5xx: v.errores, promedioMs: r2(v.msTotal / v.pedidos), maxMs: r2(v.msMax) }])
    ),
    proceso: { memoriaRssMb: r2(mem.rss / 1048576), heapUsadoMb: r2(mem.heapUsed / 1048576) },
  };
}

// Formato de texto de Prometheus: lo que leería un recolector externo (fuera de
// alcance, pero así se conectaría sin tocar el código).
function prometheus(servicio) {
  const s = instantanea(servicio);
  const l = (nombre, valor, etiquetas = {}) => {
    const e = Object.entries({ servicio, ...etiquetas }).map(([k, v]) => `${k}="${String(v).replace(/"/g, "'")}"`).join(",");
    return `${nombre}{${e}} ${valor}`;
  };
  const lineas = [
    "# TYPE torque_pedidos_total counter",
    ...Object.entries(s.pedidos.porStatus).map(([st, n]) => l("torque_pedidos_total", n, { status: st })),
    "# TYPE torque_pedidos_en_curso gauge",
    l("torque_pedidos_en_curso", s.pedidos.enCurso),
    "# TYPE torque_tiempo_respuesta_ms gauge",
    ...["promedio", "p50", "p95", "p99", "max"].map((q) => l("torque_tiempo_respuesta_ms", s.tiempoRespuestaMs[q], { estadistico: q })),
    "# TYPE torque_ruta_pedidos_total counter",
    ...Object.entries(s.porRuta).map(([ruta, v]) => l("torque_ruta_pedidos_total", v.pedidos, { ruta })),
    "# TYPE torque_ruta_tiempo_promedio_ms gauge",
    ...Object.entries(s.porRuta).map(([ruta, v]) => l("torque_ruta_tiempo_promedio_ms", v.promedioMs, { ruta })),
    "# TYPE torque_uptime_segundos gauge",
    l("torque_uptime_segundos", s.uptimeSegundos),
  ];
  return `${lineas.join("\n")}\n`;
}

function endpoint(servicio) {
  return (req, res) => {
    if (req.query.formato === "prometheus") {
      return res.type("text/plain; version=0.0.4").send(prometheus(servicio));
    }
    return res.json(instantanea(servicio));
  };
}

module.exports = { middleware, endpoint, instantanea };
